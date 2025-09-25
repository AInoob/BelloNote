const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4175'
const SHORT_TIMEOUT = 1000

async function ensureBackendReady(request) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${API_URL}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

async function setOutlineNormalized(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok(), 'outline set should succeed').toBeTruthy()
}

async function waitForOutline(request) {
  const response = await request.get(`${API_URL}/api/outline`)
  expect(response.ok(), 'outline fetch should succeed').toBeTruthy()
  return response.json()
}

async function waitForEditorReady(page) {
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    if (!text) return 'ready'
    return text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000 }).toBe('ready')
  await expect.poll(async () => editor.locator('li.li-node').count(), { timeout: SHORT_TIMEOUT }).toBeGreaterThan(0)
  return editor
}

async function placeCaretAtTaskEnd(page, index) {
  await page.evaluate((idx) => {
    const editor = window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor not ready')
    const view = editor.view
    const paragraphs = Array.from(document.querySelectorAll('li.li-node p'))
    const target = paragraphs[idx]
    if (!target) throw new Error('List item paragraph missing')
    const pos = view.posAtDOM(target, target.childNodes.length)
    editor.commands.setTextSelection({ from: pos, to: pos })
  }, index)
}

async function createTasks(page, titles) {
  const editor = page.locator('.tiptap.ProseMirror')
  const listItems = editor.locator('li.li-node')
  const firstParagraph = listItems.first().locator('p').first()
  await firstParagraph.click()
  // Replace starter text
  await page.evaluate(() => {
    const paragraph = document.querySelector('li.li-node p')
    if (!paragraph) return
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  for (let i = 0; i < titles.length; i += 1) {
    if (i > 0) {
      await page.keyboard.press('Enter')
      await listItems.nth(i).locator('p').first().click()
    }
    await page.keyboard.type(titles[i])
    await expect(listItems.nth(i)).toContainText(titles[i], { timeout: SHORT_TIMEOUT })
  }
}

test.beforeEach(async ({ request }) => {
  await resetOutline(request)
})

test('slash tagging and tag filters support include/exclude with persistence', async ({ page, request }) => {
  await ensureBackendReady(request)
  await page.goto('/')
  await waitForEditorReady(page)

  await createTasks(page, ['Task 1 root', 'Task 2 urgent', 'Task 3 later'])

  // Tag task 2 with #urgent via slash
  await placeCaretAtTaskEnd(page, 1)
  await page.keyboard.type('/')
  const slashMenu = page.locator('.slash-menu')
  await expect(slashMenu).toBeVisible({ timeout: SHORT_TIMEOUT })
  await page.keyboard.type('#urgent')
  const urgentOption = slashMenu.locator('button', { hasText: 'Add tag #urgent' }).first()
  await expect(urgentOption).toBeVisible({ timeout: SHORT_TIMEOUT })
  await page.keyboard.press('Enter')
  const outlineItems = page.locator('.tiptap.ProseMirror li.li-node')
  await expect.poll(async () => await outlineItems.nth(1).getAttribute('data-tags-self'), {
    timeout: SHORT_TIMEOUT
  }).toBe('urgent')

  // Tag task 3 with #later via slash
  await placeCaretAtTaskEnd(page, 2)
  await page.keyboard.type('/')
  await expect(page.locator('.slash-menu')).toBeVisible({ timeout: SHORT_TIMEOUT })
  await page.keyboard.type('#later')
  const laterOption = page.locator('.slash-menu button', { hasText: 'Add tag #later' }).first()
  await expect(laterOption).toBeVisible({ timeout: SHORT_TIMEOUT })
  await page.keyboard.press('Enter')
  await expect.poll(async () => await outlineItems.nth(2).getAttribute('data-tags-self'), {
    timeout: SHORT_TIMEOUT
  }).toBe('later')

  // Ensure tags persisted to API
  await expect.poll(async () => {
    const data = await waitForOutline(request)
    const roots = data.roots || []
    if (roots.length < 3) return null
    return {
      second: roots[1]?.tags || [],
      third: roots[2]?.tags || []
    }
  }, { message: 'outline should report tags for tagged tasks', timeout: 10000 }).toEqual({
    second: ['urgent'],
    third: ['later']
  })

  const includeInput = page.locator('.tag-filter-group .tag-filter.include .tag-input')
  const excludeInput = page.locator('.tag-filter-group .tag-filter.exclude .tag-input')
  const clearButton = page.locator('.tag-filter-group .btn.ghost', { hasText: 'Clear' })

  // Apply include filter for #urgent
  await includeInput.fill('#urgent')
  await includeInput.press('Enter')
  const includeChip = page.locator('.tag-filter.include .tag-chip', { hasText: '#urgent' })
  await expect(includeChip).toBeVisible({ timeout: SHORT_TIMEOUT })

  const task1 = outlineItems.filter({ hasText: 'Task 1 root' }).first()
  const task2 = outlineItems.filter({ hasText: 'Task 2 urgent' }).first()
  const task3 = outlineItems.filter({ hasText: 'Task 3 later' }).first()

  await expect(task2).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task1).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(task3).toBeHidden({ timeout: SHORT_TIMEOUT })

  // Remove include chip by clicking it
  await includeChip.click()
  await expect(includeChip).toHaveCount(0, { timeout: SHORT_TIMEOUT })

  // Apply exclude filter for #later
  await excludeInput.fill('#later')
  await excludeInput.press('Enter')
  const excludeChip = page.locator('.tag-filter.exclude .tag-chip', { hasText: '#later' })
  await expect(excludeChip).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task3).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(task1).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task2).toBeVisible({ timeout: SHORT_TIMEOUT })

  // Add include filter again so both are active
  await includeInput.fill('#urgent')
  await includeInput.press('Enter')
  await expect(includeChip).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(clearButton).toBeVisible({ timeout: SHORT_TIMEOUT })

  // Reload to confirm persistence
  await page.reload()
  await waitForEditorReady(page)
  await expect(page.locator('.tag-filter.include .tag-chip', { hasText: '#urgent' })).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(page.locator('.tag-filter.exclude .tag-chip', { hasText: '#later' })).toBeVisible({ timeout: SHORT_TIMEOUT })

  // Filters should remain in effect after reload
  const reloadedItems = page.locator('.tiptap.ProseMirror li.li-node')
  const task1Reloaded = reloadedItems.filter({ hasText: 'Task 1 root' }).first()
  const task2Reloaded = reloadedItems.filter({ hasText: 'Task 2 urgent' }).first()
  const task3Reloaded = reloadedItems.filter({ hasText: 'Task 3 later' }).first()
  await expect(task2Reloaded).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task1Reloaded).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(task3Reloaded).toBeHidden({ timeout: SHORT_TIMEOUT })

  // Clear filters
  await page.locator('.tag-filter-group .btn.ghost', { hasText: 'Clear' }).click()
  await expect(page.locator('.tag-filter .tag-chip')).toHaveCount(0, { timeout: SHORT_TIMEOUT })
  await expect(task1Reloaded).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task2Reloaded).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(task3Reloaded).toBeVisible({ timeout: SHORT_TIMEOUT })
})

test('excluding a tag hides matching child but keeps parent visible', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  await setOutlineNormalized(request, [
    {
      id: null,
      title: 'Parent without tag',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent without tag' }] }],
      children: [
        {
          id: null,
          title: 'Child secret #secret',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child secret #secret' }] }],
          children: []
        }
      ]
    },
    {
      id: null,
      title: 'Another visible task',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Another visible task' }] }],
      children: []
    }
  ])

  await page.goto('/')
  await waitForEditorReady(page)

  const outline = page.locator('.tiptap.ProseMirror')
  const parent = outline.locator('li.li-node[data-body-text="Parent without tag"]').first()
  const child = outline.locator('li.li-node[data-body-text="Child secret #secret"]').first()
  await expect(parent).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(child).toBeVisible({ timeout: SHORT_TIMEOUT })

  const excludeInput = page.locator('.tag-filter-group .tag-filter.exclude .tag-input')
  await excludeInput.fill('#secret')
  await excludeInput.press('Enter')

  await expect(page.locator('.tag-filter.exclude .tag-chip', { hasText: '#secret' })).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(child).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(parent, 'parent should remain visible when only child matches excluded tag').toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => await parent.getAttribute('data-tag-exclude'), { timeout: SHORT_TIMEOUT }).toBe('0')
})
