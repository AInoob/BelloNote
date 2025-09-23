const { test, expect } = require('@playwright/test')

const ORIGIN = process.env.PLAYWRIGHT_ORIGIN || 'http://127.0.0.1:4175'
const CLIENT_URL = process.env.PLAYWRIGHT_CLIENT_URL || 'http://127.0.0.1:5232'

test.describe.configure({ mode: 'serial' })

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

async function resetOutline(request, outline) {
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function baseOutline() {
  return [
    {
      id: null,
      title: 'Copy baseline',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Copy baseline' }] }],
      children: []
    }
  ]
}

test('copying a selection only copies highlighted text', async ({ page, request, context }) => {
  await ensureBackendReady(request)
  await resetOutline(request, baseOutline())
  await page.goto('/')
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const firstParagraph = page.locator('li.li-node').first().locator('.li-content div[data-node-view-content-react] > p')
  await firstParagraph.click()
  await page.keyboard.press(`${modifier}+a`)
  await page.keyboard.type('Copy test example')
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR__ || window.__WORKLOG_EDITOR
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

  await page.keyboard.press(`${modifier}+C`)
  await page.waitForTimeout(30)

  const payload = await page.evaluate(() => window.__WORKLOG_TEST_COPY__)
  expect(payload?.text?.trim()).toBe('example')
  expect(() => JSON.parse(payload?.json || '{}')).not.toThrow()
})
