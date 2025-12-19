const { test, expect } = require('./test-base')

const SHORT_TIMEOUT = 10000

async function ensureEditorReady(page) {
  const editor = page.locator('.tiptap.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: SHORT_TIMEOUT }).toBe('ready')
}

test('Backspace on an empty nested leaf task deletes it and moves caret to end of previous node', async ({ page, app }) => {
  await app.resetOutline([])
  await page.goto('/')
  await ensureEditorReady(page)

  // Build:
  // - Task 1
  //   - Task 2
  //     - Task 3
  await page.locator('li.li-node').first().locator('p').first().click()
  await page.keyboard.type('Task 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task 2')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task 3')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(120)

  // Sanity: we have 3 list items in the DOM.
  await expect(page.locator('li.li-node')).toHaveCount(3)

  // Select just the "Task 3" text and delete it, leaving an empty leaf task.
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor?.view) throw new Error('editor not ready')
    const { state } = editor.view
    let paraPos = null
    let paraNode = null
    state.doc.descendants((node, pos) => {
      if (paraPos != null) return false
      if (node.type.name === 'paragraph' && node.textContent === 'Task 3') {
        paraPos = pos
        paraNode = node
        return false
      }
      return undefined
    })
    if (paraPos == null || !paraNode) throw new Error('Task 3 paragraph not found')
    const from = paraPos + 1
    const to = from + (paraNode.content?.size || 0)
    editor.chain().focus().setTextSelection({ from, to }).run()
  })

  await page.keyboard.press('Backspace') // clears "Task 3" text
  await page.waitForTimeout(80)

  // Now the leaf node is empty. One more Backspace should delete it and jump to Task 2 end.
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(120)

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(2)

  // Type a marker to prove caret is at the end of Task 2 (not beginning).
  await page.keyboard.type('X')
  await page.waitForTimeout(80)

  const task2Text = await items.nth(1).evaluate((li) => {
    const p = li.querySelector('p')
    return p ? p.textContent : ''
  })
  expect(task2Text).toBe('Task 2X')
})

test('Backspace deleting empty nested leaf sibling jumps to end of previous sibling (item4 -> item3)', async ({ page, app }) => {
  await app.resetOutline([])
  await page.goto('/')
  await ensureEditorReady(page)

  // Build:
  // - Item 1
  //   - Item 2
  //     - Item 3
  //     - Item 4
  await page.locator('li.li-node').first().locator('p').first().click()
  await page.keyboard.type('Item 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Item 2')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Item 3')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Item 4')
  await page.waitForTimeout(150)

  const itemsBefore = page.locator('li.li-node')
  await expect(itemsBefore).toHaveCount(4)

  // Select just the "Item 4" text and delete it, leaving an empty leaf listItem.
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor?.view) throw new Error('editor not ready')
    const { state } = editor.view
    let paraPos = null
    let paraNode = null
    state.doc.descendants((node, pos) => {
      if (paraPos != null) return false
      if (node.type.name === 'paragraph' && node.textContent === 'Item 4') {
        paraPos = pos
        paraNode = node
        return false
      }
      return undefined
    })
    if (paraPos == null || !paraNode) throw new Error('Item 4 paragraph not found')
    const from = paraPos + 1
    const to = from + (paraNode.content?.size || 0)
    editor.chain().focus().setTextSelection({ from, to }).run()
  })

  await page.keyboard.press('Backspace') // clears "Item 4"
  await page.waitForTimeout(80)
  await page.keyboard.press('Backspace') // deletes empty Item 4 and should jump to end of Item 3
  await page.waitForTimeout(150)

  const itemsAfter = page.locator('li.li-node')
  await expect(itemsAfter).toHaveCount(3)

  // Prove caret is at end of Item 3 by typing a marker and asserting it appends to Item 3.
  await page.keyboard.type('X')
  await page.waitForTimeout(80)

  const item2Text = await itemsAfter.nth(1).evaluate((li) => li.querySelector('p')?.textContent || '')
  const item3Text = await itemsAfter.nth(2).evaluate((li) => li.querySelector('p')?.textContent || '')
  expect(item2Text).toBe('Item 2')
  expect(item3Text).toBe('Item 3X')
})


