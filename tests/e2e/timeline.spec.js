const { test, expect } = require('@playwright/test')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4175'

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok()).toBeTruthy()
}

async function seedOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function fmt(d) { return d.toISOString().slice(0,10) }

function todayStr() { return fmt(new Date()) }

function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1); return fmt(d)
}

async function openTimeline(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('.timeline')).toBeVisible({ timeout: 10000 })
}

function sectionByDate(page, dateStr) {
  return page.locator('.timeline > section').filter({ has: page.locator('h3', { hasText: dateStr }) })
}

function listItemsInSection(page, section) {
  return section.locator('.history-inline-preview li.li-node')
}

test.beforeEach(async ({ request }) => { await resetOutline(request) })

// 1) Parent with date -> subtasks without dates are shown in Timeline
// 2) Parent line preserves @date token in Timeline
// 3) Day height adapts to content (more items -> taller)

test('timeline shows subtasks for dated parent and preserves date; day height adapts', async ({ page, request }) => {
  const today = todayStr()
  const yesterday = yesterdayStr()

  // Seed outline:
  // - One parent with today date + 5 children
  // - One small parent with yesterday date + 1 child
  await seedOutline(request, [
    {
      title: 'GTPN Ops Agent V2.1', status: 'in-progress', dates: [today],
      children: [
        { title: 'Code - link' },
        { title: 'Argo - link' },
        { title: 'Deployment - link' },
        { title: 'Inform Carlos' },
        { title: 'Set timeout for slack prompt cache' }
      ]
    },
    {
      title: 'Quick check', status: 'todo', dates: [yesterday],
      children: [{ title: 'One step' }]
    }
  ])

  await openTimeline(page)

  // Today section assertions
  const todaySection = sectionByDate(page, today)
  await expect(todaySection).toHaveCount(1)
  const todayItems = listItemsInSection(page, todaySection)
  const todayParent = todayItems.filter({ hasText: 'GTPN Ops Agent V2.1' })
  expect(await todayParent.count()).toBeGreaterThan(0)

  // Verify all expected children are visible under the section
  const scope = todaySection.locator('.history-inline-preview')
  for (const label of [
    'Code - link',
    'Argo - link',
    'Deployment - link',
    'Inform Carlos',
    'Set timeout for slack prompt cache'
  ]) {
    await expect(scope, `Missing child: ${label}`).toContainText(label)
  }

  // Yesterday section (smaller content)
  const yestSection = sectionByDate(page, yesterday)
  await expect(yestSection).toHaveCount(1)
  const yestItems = listItemsInSection(page, yestSection)
  const yestParent = yestItems.filter({ hasText: 'Quick check' })
  await expect(yestParent).toHaveCount(1)
  await expect(yestParent.first()).toContainText(`@${yesterday}`)
  await expect(yestSection.locator('.history-inline-preview')).toContainText('One step')

  // Height comparison (today should be taller than yesterday by a margin)
  const [hToday, hYest] = await Promise.all([
    todaySection.boundingBox().then(b => b?.height || 0),
    yestSection.boundingBox().then(b => b?.height || 0)
  ])
  expect(hToday).toBeGreaterThan(hYest + 30)
})

