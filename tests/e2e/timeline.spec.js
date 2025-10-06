const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

let API_URL = null
const SHORT_TIMEOUT = 1000

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

async function seedOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

function fmt(d) { return d.toISOString().slice(0,10) }

function todayStr() { return fmt(new Date()) }

function todayAt(hour = 23, minute = 59) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString().slice(0,16)
}

function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1); return fmt(d)
}

async function openTimeline(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Timeline' }).click()
  await page.waitForTimeout(200)
  await expect(page.locator('.timeline')).toBeVisible({ timeout: SHORT_TIMEOUT })
}

function sectionByDate(page, dateStr) {
  return page.locator('.timeline > section').filter({ has: page.locator('h3', { hasText: dateStr }) })
}

function listItemsInSection(page, section) {
  return section.locator('.history-inline-preview li.li-node')
}

test.beforeEach(async ({ request, app }) => { API_URL = app.apiUrl; await resetOutline(request) })

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

test('timeline includes tasks scheduled via reminders on the due date', async ({ page, request }) => {
  await resetOutline(request)
  const today = todayStr()

  const remindAt = `${today}T15:00`
  await seedOutline(request, [
    {
      title: 'Reminder Task',
      status: 'todo',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Reminder Task [[reminder|incomplete|${remindAt}]]` }] }
      ],
      children: []
    }
  ])

  await openTimeline(page)

  const todaySection = sectionByDate(page, today)
  await expect(todaySection).toHaveCount(1, { timeout: SHORT_TIMEOUT * 5 })
  const todayItems = listItemsInSection(page, todaySection)
  await expect(todayItems).toContainText('Reminder Task', { timeout: SHORT_TIMEOUT * 5 })
  const reminderRow = todayItems.filter({ hasText: 'Reminder Task' }).first()
  await expect(reminderRow.locator('.li-reminder-area .reminder-toggle')).toBeVisible({ timeout: SHORT_TIMEOUT * 5 })
})

function daysAgoStr(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return fmt(d)
}

test('timeline lazy mounts offscreen day editors until scrolled into view', async ({ page, request }) => {
  await resetOutline(request)

  const TOTAL_DAYS = 18
  const outline = []
  for (let i = 0; i < TOTAL_DAYS; i += 1) {
    const date = daysAgoStr(i)
    outline.push({
      title: `Lazy timeline parent ${i}`,
      status: 'todo',
      dates: [date],
      children: [{ title: `Lazy timeline child ${i}` }]
    })
  }
  await seedOutline(request, outline)

  await openTimeline(page)

  const farIndex = TOTAL_DAYS - 1
  const farDate = daysAgoStr(farIndex)
  const farSection = sectionByDate(page, farDate)
  await expect(farSection).toHaveCount(1)

  const preview = farSection.locator('.history-inline-preview')
  const proseMirror = preview.locator('.ProseMirror')
  await expect(proseMirror, 'expected far timeline section to remain unmounted while offscreen').toHaveCount(0)

  await farSection.scrollIntoViewIfNeeded()

  await expect(proseMirror, 'expected timeline section to mount once scrolled into view').toHaveCount(1)
  await expect(preview).toContainText(`Lazy timeline child ${farIndex}`)
})
