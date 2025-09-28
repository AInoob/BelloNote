
const { test, expect, expectOutlineState, outlineNode } = require('./test-base')

test.describe.configure({ mode: 'serial' })

async function ensureBackendReady(request, app) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${app.apiUrl}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(app, outline) {
  await app.resetOutline(outline)
}

function baseOutline() {
  return [
    {
      id: null,
      title: 'Copy test example',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Copy test example' }] }],
      children: []
    }
  ]
}

test('copying a selection only copies highlighted text', async ({ page, request, app, context }) => {
  await ensureBackendReady(request, app)
  await resetOutline(app, baseOutline())
  await page.goto('/')
  await expectOutlineState(page, [outlineNode('Copy test example', { status: 'todo' })], { includeTags: false })
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const firstParagraph = page.locator('li.li-node').first().locator('.li-content div[data-node-view-content-react] > p')
  await firstParagraph.click()
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR__ || window.__WORKLOG_EDITOR
    if (!editor) return
    let from = null
    let to = null
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || from !== null) return undefined
      const value = node.text || ''
      const target = 'example'
      const index = value.indexOf(target)
      if (index !== -1) {
        from = pos + index
        to = from + target.length
        return false
      }
      return undefined
    })
    if (from !== null && to !== null) {
      editor.chain().focus().setTextSelection({ from, to }).run()
    }
  })

  const selectionText = await page.evaluate(() => window.getSelection()?.toString() || '')
  expect(selectionText.trim()).toBe('example')
  await expectOutlineState(page, [outlineNode('Copy test example', { status: 'todo' })], { includeTags: false })

  await page.keyboard.press(`${modifier}+C`)
  await page.waitForTimeout(30)

  const payload = await page.evaluate(() => window.__WORKLOG_TEST_COPY__)
  expect(payload?.text?.trim()).toBe('example')
  expect(() => JSON.parse(payload?.json || '{}')).not.toThrow()
  await expectOutlineState(page, [outlineNode('Copy test example', { status: 'todo' })], { includeTags: false })
})
