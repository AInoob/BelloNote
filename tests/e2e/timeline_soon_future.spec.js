const { test, expect } = require('@playwright/test')

test.describe.configure({ mode: 'serial' })

const ORIGIN = process.env.PLAYWRIGHT_ORIGIN || 'http://127.0.0.1:4175'

async function ensureBackendReady(request) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${ORIGIN}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(request) {
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline: [] } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

function seedSoonFutureOutline(todayStr) {
  return [
    {
      id: null,
      title: 'soon parent @soon',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: [
        {
          id: null,
          title: 'soon child',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon child task' }] }],
          children: []
        }
      ]
    },
    {
      id: null,
      title: 'future parent @future',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'future parent @future' }] }],
      children: []
    },
    {
      id: null,
      title: `dated item @${todayStr}`,
      status: 'todo',
      dates: [todayStr],
      ownWorkedOnDates: [todayStr],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `worked on @${todayStr}` }] }],
      children: []
    }
  ]
}

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`
}

// 1) Timeline renders Soon and Future buckets; future can be toggled off
//    Soon items are shown by default and unaffected by future toggle
//    Future items are shown by default and hidden when toggled off
//    Dated items remain grouped under their date

test('timeline shows Soon and Future and can hide Future', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  const outline = seedSoonFutureOutline(todayStr())
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok(), 'outline set should succeed').toBeTruthy()

  await page.goto('/')
  await page.getByRole('button', { name: 'Timeline' }).click()

  // Wait for dated section to ensure data loaded
  await expect(page.locator('h3', { hasText: todayStr() })).toBeVisible()

  // Soon section appears with its items
  const soonSection = page.locator('section', { has: page.locator('h3', { hasText: 'Soon' }) })
  await expect(soonSection).toBeVisible()
  await expect(soonSection.locator('.history-inline-preview')).toContainText('soon parent')
  await expect(soonSection.locator('.history-inline-preview')).toContainText('soon child')

  // Future section appears with its items
  const futureSection = page.locator('section', { has: page.locator('h3', { hasText: 'Future' }) })
  await expect(futureSection).toBeVisible()
  await expect(futureSection.locator('.history-inline-preview')).toContainText('future parent')

  // Validate order: Future appears before Soon
  const headers = await page.locator('h3').allTextContents()
  const idxFuture = headers.indexOf('Future')
  const idxSoon = headers.indexOf('Soon')
  expect(idxFuture).toBeGreaterThanOrEqual(0)
  expect(idxSoon).toBeGreaterThanOrEqual(0)
  expect(idxFuture).toBeLessThan(idxSoon)

  // Dated section already visible
  const dateSection = page.locator('section', { has: page.locator('h3', { hasText: todayStr() }) })
  await expect(dateSection.locator('.history-inline-preview')).toContainText('worked on')

  // Toggle future off (use the timeline-level filter bar)
  const futureToggle = page.locator('[data-timeline-filter="1"] .future-toggle .btn.pill')
  await expect(futureToggle).toHaveClass(/active/)
  await futureToggle.click()
  await expect(futureToggle).not.toHaveClass(/active/)

  // Future section should disappear, Soon remains
  await expect(page.locator('h3', { hasText: 'Future' })).toHaveCount(0)
  await expect(page.locator('h3', { hasText: 'Soon' })).toBeVisible()

  // Persistence: reload and ensure Future remains hidden
  await page.reload()
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('[data-timeline-filter="1"] .future-toggle .btn.pill')).not.toHaveClass(/active/)
  await expect(page.locator('h3', { hasText: 'Future' })).toHaveCount(0)
})

