const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4175'

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
  await expect(editor.locator('li.li-node').first()).toBeVisible()
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
  const listItems = page.locator('li.li-node')
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
    }
    await page.keyboard.type(titles[i])
    await expect(listItems.nth(i)).toContainText(titles[i])
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
  await page.keyboard.type('/#urgent')
  await page.keyboard.press('Enter')
  await expect.poll(async () => await page.locator('li.li-node').nth(1).getAttribute('data-tags-self'), {
    timeout: 10000
  }).toBe('urgent')

  // Tag task 3 with #later via slash
  await placeCaretAtTaskEnd(page, 2)
  await page.keyboard.type('/#later')
  await page.keyboard.press('Enter')
  await expect.poll(async () => await page.locator('li.li-node').nth(2).getAttribute('data-tags-self'), {
    timeout: 10000
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
  await expect(includeChip).toBeVisible()

  const task1 = page.locator('li.li-node', { hasText: 'Task 1 root' })
  const task2 = page.locator('li.li-node', { hasText: 'Task 2 urgent' })
  const task3 = page.locator('li.li-node', { hasText: 'Task 3 later' })

  await expect(task2).toBeVisible()
  await expect(task1).toBeHidden()
  await expect(task3).toBeHidden()

  // Remove include chip by clicking it
  await includeChip.click()
  await expect(includeChip).toHaveCount(0)

  // Apply exclude filter for #later
  await excludeInput.fill('#later')
  await excludeInput.press('Enter')
  const excludeChip = page.locator('.tag-filter.exclude .tag-chip', { hasText: '#later' })
  await expect(excludeChip).toBeVisible()
  await expect(task3).toBeHidden()
  await expect(task1).toBeVisible()
  await expect(task2).toBeVisible()

  // Add include filter again so both are active
  await includeInput.fill('#urgent')
  await includeInput.press('Enter')
  await expect(includeChip).toBeVisible()
  await expect(clearButton).toBeVisible()

  // Reload to confirm persistence
  await page.reload()
  await waitForEditorReady(page)
  await expect(page.locator('.tag-filter.include .tag-chip', { hasText: '#urgent' })).toBeVisible()
  await expect(page.locator('.tag-filter.exclude .tag-chip', { hasText: '#later' })).toBeVisible()

  // Filters should remain in effect after reload
  const task1Reloaded = page.locator('li.li-node', { hasText: 'Task 1 root' })
  const task2Reloaded = page.locator('li.li-node', { hasText: 'Task 2 urgent' })
  const task3Reloaded = page.locator('li.li-node', { hasText: 'Task 3 later' })
  await expect(task2Reloaded).toBeVisible()
  await expect(task1Reloaded).toBeHidden()
  await expect(task3Reloaded).toBeHidden()

  // Clear filters
  await page.locator('.tag-filter-group .btn.ghost', { hasText: 'Clear' }).click()
  await expect(page.locator('.tag-filter .tag-chip')).toHaveCount(0)
  await expect(task1Reloaded).toBeVisible()
  await expect(task2Reloaded).toBeVisible()
  await expect(task3Reloaded).toBeVisible()
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

  const parent = page.locator('li.li-node[data-body-text="Parent without tag"]').first()
  const child = page.locator('li.li-node[data-body-text="Child secret #secret"]').first()
  await expect(parent).toBeVisible()
  await expect(child).toBeVisible()

  const excludeInput = page.locator('.tag-filter-group .tag-filter.exclude .tag-input')
  await excludeInput.fill('#secret')
  await excludeInput.press('Enter')

  await expect(page.locator('.tag-filter.exclude .tag-chip', { hasText: '#secret' })).toBeVisible()
  await expect(child).toBeHidden()
  await expect(parent, 'parent should remain visible when only child matches excluded tag').toBeVisible()
  await expect.poll(async () => await parent.getAttribute('data-tag-exclude'), { timeout: 5000 }).toBe('0')
})
