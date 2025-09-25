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
  await page.waitForSelector('.status-filter-bar')

  const todoBtn = page.locator('.status-filter-bar .btn.pill[data-status="todo"]').first()
  const ipBtn = page.locator('.status-filter-bar .btn.pill[data-status="in-progress"]').first()
  const doneBtn = page.locator('.status-filter-bar .btn.pill[data-status="done"]').first()
  const archivedToggle = page.locator('.status-filter-bar .archive-toggle .btn.pill').first()
  const futureToggle = page.locator('.status-filter-bar .future-toggle .btn.pill').first()

  // Initial sanity: all status filters and toggles should be active (Shown)
  await expect(todoBtn).toHaveClass(/active/)
  await expect(ipBtn).toHaveClass(/active/)
  await expect(doneBtn).toHaveClass(/active/)
  await expect(archivedToggle).toHaveClass(/active/)
  await expect(futureToggle).toHaveClass(/active/)

  // Adjust filters: keep only todo; hide archived and future
  await ipBtn.click()
  await doneBtn.click()
  await archivedToggle.click()
  await futureToggle.click()

  await expect(todoBtn).toHaveClass(/active/)
  await expect(ipBtn).not.toHaveClass(/active/)
  await expect(doneBtn).not.toHaveClass(/active/)
  await expect(archivedToggle).not.toHaveClass(/active/)
  await expect(futureToggle).not.toHaveClass(/active/)

  // Visibility should reflect filters
  const itemA = page.locator('li.li-node', { hasText: 'A todo' })
  const itemB = page.locator('li.li-node', { hasText: 'B in progress' })
  const itemC = page.locator('li.li-node', { hasText: 'C done' })
  // Confirm storage after toggles
  const storedBeforeNav = await page.evaluate(() => localStorage.getItem('worklog.filter.status'))
  // Expect JSON with in-progress=false, done=false, todo=true
  expect(storedBeforeNav && storedBeforeNav.includes('"in-progress":false')).toBeTruthy()

  const itemD = page.locator('li.li-node', { hasText: 'D archived' })
  const itemE = page.locator('li.li-node', { hasText: 'E future' })
  await expect(itemA).toBeVisible()
  await expect(itemB).toBeHidden()
  await expect(itemC).toBeHidden()
  await expect(itemD).toBeHidden()
  await expect(itemE).toBeHidden()

  // Go to Timeline and back to Outline
  await page.getByRole('button', { name: 'Timeline' }).click()
  await page.getByRole('button', { name: 'Outline' }).click()

  // Filters should persist
  await expect(todoBtn).toHaveClass(/active/)
  await expect(ipBtn).not.toHaveClass(/active/)
  await expect(doneBtn).not.toHaveClass(/active/)
  await expect(archivedToggle).not.toHaveClass(/active/)
  await expect(futureToggle).not.toHaveClass(/active/)

  // Reload and verify again
  await page.reload()
  await page.waitForSelector('.status-filter-bar')
  await expect(todoBtn).toHaveClass(/active/)
  await expect(ipBtn).not.toHaveClass(/active/)
  await expect(doneBtn).not.toHaveClass(/active/)
  await expect(archivedToggle).not.toHaveClass(/active/)
  await expect(futureToggle).not.toHaveClass(/active/)

  // And visibility still matches
  await expect(itemA).toBeVisible()
  await expect(itemB).toBeHidden()
  await expect(itemC).toBeHidden()
  await expect(itemD).toBeHidden()
  await expect(itemE).toBeHidden()
})

