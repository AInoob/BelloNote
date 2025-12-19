const { test, expect } = require('./test-base')

test('Enter at start of a second paragraph moves it into a new item without a blank first line', async ({ page, app }) => {
  await app.resetOutline([])

  await page.goto('/')
  const editorRoot = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editorRoot.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000 }).toBe('ready')

  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor not ready')
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              attrs: { status: '' },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'item1 line1' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'line2' }] }
              ]
            }
          ]
        }
      ]
    }
    editor.commands.setContent(doc)

    let targetPos = null
    editor.state.doc.descendants((node, pos) => {
      if (targetPos != null) return false
      if (node.type?.name === 'paragraph' && node.textContent === 'line2') {
        targetPos = pos + 1
        return false
      }
      return undefined
    })
    if (targetPos == null) throw new Error('Failed to locate second paragraph')
    editor.chain().focus().setTextSelection({ from: targetPos, to: targetPos }).run()
    try { editor.view?.dom?.focus?.() } catch {}
  })

  // Ensure the caret is actually at the start of the second paragraph before pressing Enter.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
      if (!editor?.state?.selection) return 'no-editor'
      const sel = editor.state.selection
      const parentType = sel.$from?.parent?.type?.name || 'none'
      const parentText = sel.$from?.parent?.textContent || ''
      const offset = sel.$from?.parentOffset ?? null
      const empty = !!sel.empty
      const focused = document.activeElement === editor.view?.dom ? 'focused' : 'blurred'
      return `${focused}:${empty ? 'empty' : 'range'}:${parentType}:${offset}:${parentText}`
    })
  }, { timeout: 5000 }).toBe('focused:empty:paragraph:0:line2')

  const itemsBefore = page.locator('li.li-node')
  await expect(itemsBefore).toHaveCount(1)

  await page.keyboard.press('Enter')

  const itemsAfter = page.locator('li.li-node')
  await expect(itemsAfter).toHaveCount(2)

  const firstParagraphs = itemsAfter
    .nth(0)
    .locator('.li-content div[data-node-view-content-react] > p')
  await expect(firstParagraphs).toHaveCount(1)
  await expect(firstParagraphs.first()).toHaveText('item1 line1')

  const secondParagraphs = itemsAfter
    .nth(1)
    .locator('.li-content div[data-node-view-content-react] > p')
  await expect(secondParagraphs).toHaveCount(1)
  await expect(secondParagraphs.first()).toHaveText('line2')
})


