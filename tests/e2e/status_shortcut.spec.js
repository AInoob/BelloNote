const { test, expect, expectOutlineState, outlineNode } = require('./test-base')

const SHORT_TIMEOUT = 2500

async function resetOutline(app, outline = []) {
  await app.resetOutline(outline)
}

function buildInitialOutline() {
  return [
    {
      id: null,
      title: 'Start here',
      status: '',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start here' }] }],
      children: []
    }
  ]
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate((el) => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible({ timeout: SHORT_TIMEOUT })
}

async function setSelectionToParagraph(page, text, { position = 'end' } = {}) {
  await page.evaluate(({ text, position }) => {
    const editor = window.__WORKLOG_EDITOR_MAIN?.chain ? window.__WORKLOG_EDITOR_MAIN : window.__WORKLOG_EDITOR
    if (!editor) throw new Error('Editor unavailable')
    const target = text.trim()
    let anchor = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return undefined
      const paragraph = node.child(0)
      if (!paragraph || paragraph.type.name !== 'paragraph') return undefined
      const content = (paragraph.textContent || '').trim()
      if (content === target) {
        const paragraphPos = pos + 1
        const paragraphStart = paragraphPos + 1
        const paragraphEnd = paragraphStart + paragraph.content.size
        anchor = position === 'start' ? paragraphStart : paragraphEnd
        return false
      }
      return undefined
    })
    if (anchor === null) throw new Error(`Paragraph with text "${text}" not found`)
    editor.chain().focus().setTextSelection({ from: anchor, to: anchor }).run()
  }, { text, position })
}

async function triggerStatusShortcut(page) {
  const useMeta = process.platform === 'darwin'
  return page.evaluate(({ useMeta }) => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('Editor unavailable')
    const view = editor.view
    if (!view) throw new Error('Editor view unavailable')
    const before = typeof window.__KEYDOWN_TOTAL === 'number' ? window.__KEYDOWN_TOTAL : 0
    const event = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      metaKey: useMeta,
      ctrlKey: !useMeta,
      shiftKey: false,
      altKey: false,
      bubbles: true,
      cancelable: true
    })
    view.dom.dispatchEvent(event)
    const after = typeof window.__KEYDOWN_TOTAL === 'number' ? window.__KEYDOWN_TOTAL : before
    return { before, after }
  }, { useMeta })
}

test.beforeEach(async ({ app }) => {
  await resetOutline(app, buildInitialOutline())
})

test('Cmd/Ctrl+T cycles the active task status', async ({ page }) => {
  await openOutline(page)
  await setSelectionToParagraph(page, 'Start here', { position: 'end' })

  const firstLi = page.locator('li.li-node').first()

  const firstTrigger = await triggerStatusShortcut(page)
  expect(firstTrigger.after).toBeGreaterThan(firstTrigger.before)
  await expect(firstLi).toHaveAttribute('data-status', 'todo', { timeout: SHORT_TIMEOUT })

  const secondTrigger = await triggerStatusShortcut(page)
  expect(secondTrigger.after).toBeGreaterThan(secondTrigger.before)
  await expect(firstLi).toHaveAttribute('data-status', 'in-progress', { timeout: SHORT_TIMEOUT })

  await expectOutlineState(page, [
    outlineNode('Start here', { status: 'in-progress' })
  ])
})
