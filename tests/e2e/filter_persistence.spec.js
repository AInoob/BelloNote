
const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const SHORT_TIMEOUT = 2000

async function resetOutline(app, outline = []) {
  await app.resetOutline(outline)
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

test('filters persist across navigation and reload', async ({ page, request, app }) => {
  await resetOutline(app)
  await resetOutline(app, seedMixedOutline())

  await page.goto('/')

  const filterBar = page.locator('.status-filter-bar:not([data-timeline-filter])').first()
  const outlineEditor = page.locator('.tiptap.ProseMirror').first()
  await expect(filterBar).toBeVisible({ timeout: SHORT_TIMEOUT * 3 })
  await expect(outlineEditor).toContainText('A todo', { timeout: SHORT_TIMEOUT * 5 })

  const todoBtn = filterBar.locator('.btn.pill[data-status="todo"]').first()
  const ipBtn = filterBar.locator('.btn.pill[data-status="in-progress"]').first()
  const doneBtn = filterBar.locator('.btn.pill[data-status="done"]').first()
  const archivedToggle = filterBar.locator('.archive-toggle .btn.pill').first()
  const futureToggle = filterBar.locator('.future-toggle .btn.pill').first()

  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  await ipBtn.click()
  await doneBtn.click()
  await archivedToggle.click()
  await futureToggle.click()

  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  const itemA = outlineEditor.locator('li.li-node', { hasText: 'A todo' })
  const itemB = outlineEditor.locator('li.li-node', { hasText: 'B in progress' })
  const itemC = outlineEditor.locator('li.li-node', { hasText: 'C done' })
  const storedBeforeNav = await page.evaluate(() => localStorage.getItem('worklog.filter.status'))
  expect(storedBeforeNav && storedBeforeNav.includes('"in-progress":false')).toBeTruthy()

  const itemD = outlineEditor.locator('li.li-node', { hasText: 'D archived' })
  const itemE = outlineEditor.locator('li.li-node', { hasText: 'E future' })
  await expect(itemA).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(itemB).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemC).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemD).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemE).toBeHidden({ timeout: SHORT_TIMEOUT })

  await page.getByRole('button', { name: 'Timeline' }).click()
  await page.getByRole('button', { name: 'Outline' }).click()

  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  await page.reload()
  await expect(filterBar).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(todoBtn).toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(ipBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(doneBtn).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(archivedToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })
  await expect(futureToggle).not.toHaveClass(/active/, { timeout: SHORT_TIMEOUT })

  await expect(itemA).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(itemB).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemC).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemD).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(itemE).toBeHidden({ timeout: SHORT_TIMEOUT })
})
