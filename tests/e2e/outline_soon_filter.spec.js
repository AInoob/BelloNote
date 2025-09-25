const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const ORIGIN = process.env.PLAYWRIGHT_ORIGIN || 'http://127.0.0.1:4175'
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
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline: [] } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

function seedOutlineWithSoon() {
  return [
    {
      id: null,
      title: 'soon parent @soon',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: [
        { id: null, title: 'soon child', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon child' }] }], children: [] }
      ]
    },
    { id: null, title: 'normal task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'normal' }] }], children: [] }
  ]
}

test('outline has Soon filter that hides/shows @soon items and persists', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  const outline = seedOutlineWithSoon()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })

  // By default, soon items visible
  await expect(editor.locator('p', { hasText: 'soon parent' })).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(editor.locator('p', { hasText: 'soon child' })).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(editor.locator('p', { hasText: 'normal' })).toBeVisible({ timeout: SHORT_TIMEOUT })

  // Toggle Soon off in Outline filter bar
  const soonToggle = page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill').first()
  await soonToggle.click()
  await expect(soonToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Reload and ensure persisted (toggle remains off)
  await page.reload()
  await expect(page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill').first()).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Toggle Soon on again and ensure soon item appears
  const soonToggleAfterReload = page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill').first()
  await soonToggleAfterReload.click()
  await expect(soonToggleAfterReload).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(editor.locator('p', { hasText: 'soon parent' })).toBeVisible({ timeout: SHORT_TIMEOUT })
})
