const { test, expect } = require('./test-base')

// Keep tests serial to avoid cross-talk on outline data
test.describe.configure({ mode: 'serial' })

let ORIGIN = null
const SHORT_TIMEOUT = 1000

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
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline: []  }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

function buildToday() {
  return new Date().toISOString().slice(0, 10)
}

function buildTallOutlineForTimeline(today) {
  // Parent with @today to seed the day, and many children to make the content tall
  const children = []
  for (let i = 1; i <= 30; i++) {
    children.push({
      id: null,
      title: `child ${i}`,
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `child ${i}` }] }],
      children: []
    })
  }
  return [
    {
      id: null,
      title: `timeline parent @${today}`,
      status: 'todo',
      dates: [today],
      ownWorkedOnDates: [today],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `timeline parent @${today}` }] }],
      children
    }
  ]
}

// 1) Timeline: container should not have inner scroll or max-height
// We assert no max-height and overflow not set to auto/scroll.
// We do not rely on scrollHeight because various environments differ; the CSS check is sufficient.
test.beforeEach(async ({ app }) => {
  ORIGIN = app.apiUrl;
})

test('timeline day container has no inner scroll (no max-height/overflow)', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const today = buildToday()
  const outline = buildTallOutlineForTimeline(today)
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline  }, headers: { 'x-playwright-test': '1' } })
  expect(setRes.ok(), 'outline set should succeed').toBeTruthy()

  await page.goto('/')
  // Switch to Timeline tab
  await page.getByRole('button', { name: 'Timeline' }).click()

  // Find the history-inline-preview within the section for 'today'
  const daySection = page.locator('section', { has: page.locator('h3', { hasText: today }) })
  const preview = daySection.locator('.history-inline-preview')
  await expect(preview).toBeVisible({ timeout: SHORT_TIMEOUT })

  const styles = await preview.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { overflowY: cs.overflowY, overflow: cs.overflow, maxHeight: cs.maxHeight }
  })

  expect(styles.maxHeight, 'max-height should not be set').toBe('none')
  // Either overflow or overflowY should not indicate a scrollable container
  expect(['visible', 'clip', 'unset', 'initial', 'inherit']).toContain(styles.overflowY)
  expect(['visible', 'clip', 'unset', 'initial', 'inherit']).toContain(styles.overflow)
})

// 2) Status filter: deselected buttons are dimmed (greyed out) while keeping their color
// We toggle the In progress filter off and check opacity < 1 for that chip and 1 for others.
test('status filter buttons dim when not selected', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  await page.goto('/')

  const bar = page.locator('.status-filter-bar:not([data-timeline-filter])').first()
  await expect(bar).toBeVisible({ timeout: SHORT_TIMEOUT })

  const todoBtn = bar.locator('.btn.pill[data-status="todo"]')
  const inProgBtn = bar.locator('.btn.pill[data-status="in-progress"]')
  const doneBtn = bar.locator('.btn.pill[data-status="done"]')

  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(inProgBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Toggle In progress OFF
  await inProgBtn.click()

  // After toggle, it should not have 'active'
  await expect(inProgBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  const opacities = await Promise.all([todoBtn, inProgBtn, doneBtn].map(async (loc) => {
    return await loc.evaluate((el) => getComputedStyle(el).opacity)
  }))

  expect(opacities[0], 'todo should be fully opaque').toBe('1')
  expect(opacities[1], 'in-progress (deselected) should be dimmed').toBe('0.55')
  expect(opacities[2], 'done should be fully opaque').toBe('1')
})
