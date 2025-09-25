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

function seedMixedOutline() {
  return [
    { id: null, title: 'A todo', status: 'todo', dates: [], ownWorkedOnDates: [], content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A todo' }] }], children: [] },
    { id: null, title: 'B in progress', status: 'in-progress', dates: [], ownWorkedOnDates: [], content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B in progress' }] }], children: [] },
    { id: null, title: 'C done', status: 'done', dates: [], ownWorkedOnDates: [], content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C done' }] }], children: [] },
    { id: null, title: 'D archived @archived', status: 'todo', dates: [], ownWorkedOnDates: [], content: [{ type: 'paragraph', content: [{ type: 'text', text: 'D archived @archived' }] }], children: [] },
    { id: null, title: 'E future @future', status: 'todo', dates: [], ownWorkedOnDates: [], content: [{ type: 'paragraph', content: [{ type: 'text', text: 'E future @future' }] }], children: [] },
  ]
}

// Persist filters across timeline navigation and reload
test('filters persist across navigation and reload', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const outline = seedMixedOutline()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok(), 'outline set should succeed').toBeTruthy()

  await page.goto('/')

  // Wait for filter bar
  const filterBar = page.locator('.status-filter-bar:not([data-timeline-filter])').first()
  await expect(filterBar).toBeVisible({ timeout: SHORT_TIMEOUT })

  const todoBtn = filterBar.locator('.btn.pill[data-status="todo"]').first()
  const ipBtn = filterBar.locator('.btn.pill[data-status="in-progress"]').first()
  const doneBtn = filterBar.locator('.btn.pill[data-status="done"]').first()
  const archivedToggle = filterBar.locator('.archive-toggle .btn.pill').first()
  const futureToggle = filterBar.locator('.future-toggle .btn.pill').first()

  const outlineEditor = page.locator('.tiptap.ProseMirror').first()

  // Initial sanity: all status filters and toggles should be active (Shown)
  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Adjust filters: keep only todo; hide archived and future
  await ipBtn.click()
  await doneBtn.click()
  await archivedToggle.click()
  await futureToggle.click()

  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Visibility should reflect filters
  const itemA = outlineEditor.locator('li.li-node', { hasText: 'A todo' })
  const itemB = outlineEditor.locator('li.li-node', { hasText: 'B in progress' })
  const itemC = outlineEditor.locator('li.li-node', { hasText: 'C done' })
  // Confirm storage after toggles
  const storedBeforeNav = await page.evaluate(() => localStorage.getItem('worklog.filter.status'))
  // Expect JSON with in-progress=false, done=false, todo=true
  expect(storedBeforeNav && storedBeforeNav.includes('"in-progress":false')).toBeTruthy()

  const itemD = outlineEditor.locator('li.li-node', { hasText: 'D archived' })
  const itemE = outlineEditor.locator('li.li-node', { hasText: 'E future' })
  await expect(itemA).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(itemB).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemC).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemD).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemE).toBeHidden({ timeout: SHORT_TIMEOUT })

  // Go to Timeline and back to Outline
  await page.getByRole('button', { name: 'Timeline' }).click()
  await page.getByRole('button', { name: 'Outline' }).click()

  // Filters should persist
  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // Reload and verify again
  await page.reload()
  await expect(filterBar).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  // And visibility still matches
  await expect(itemA).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(itemB).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemC).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemD).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemE).toBeHidden({ timeout: SHORT_TIMEOUT })
})
