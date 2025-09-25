const { test, expect } = require('./test-base')

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

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`
}

function seedForTimeline() {
  const t = todayStr()
  return [
    {
      id: null,
      title: 'soon parent @soon',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: []
    },
    {
      id: null,
      title: 'future parent @future',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'future parent @future' }] }],
      children: []
    },
    {
      id: null,
      title: `dated item @${t}`,
      status: 'todo',
      dates: [t],
      ownWorkedOnDates: [t],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `worked on @${t}` }] }],
      children: []
    }
  ]
}

test('timeline filter bar visibility persists', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline: seedForTimeline() } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  await page.getByRole('button', { name: 'Timeline' }).click()
  // Wait for a timeline header to ensure loaded
  await expect(page.locator('h3', { hasText: 'Future' })).toBeVisible()

  const soonToggle = page.locator('[data-timeline-filter="1"] .soon-toggle .btn.pill')
  const futureToggle = page.locator('[data-timeline-filter="1"] .future-toggle .btn.pill')

  // Initially the toggles are visible
  await expect(soonToggle).toBeVisible()
  await expect(futureToggle).toBeVisible()

  // Hide filters via localStorage and reload
  await page.evaluate(() => localStorage.setItem('worklog.timeline.filters', '0'))
  await page.reload()
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('[data-timeline-filter="1"] .soon-toggle .btn.pill')).toHaveCount(0)
  await expect(page.locator('[data-timeline-filter="1"] .future-toggle .btn.pill')).toHaveCount(0)

  // Show filters again via localStorage and reload
  await page.evaluate(() => localStorage.setItem('worklog.timeline.filters', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('[data-timeline-filter="1"] .soon-toggle .btn.pill')).toBeVisible()
  await expect(page.locator('[data-timeline-filter="1"] .future-toggle .btn.pill')).toBeVisible()
})

