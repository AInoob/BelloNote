
const { test, expect, expectOutlineState, outlineNode } = require('./test-base')
const path = require('path')

test.describe.configure({ mode: 'serial' })

const TEST_IMAGE = path.join(__dirname, '..', 'assets', 'test-image.png')
const SHORT_TIMEOUT = 1000

const clipboardBaseState = () => [
  outlineNode('task 1', { status: 'todo' }),
  outlineNode('task 2console.log("hi")', {
    status: 'todo',
    children: [outlineNode('sub a', { status: 'todo' })]
  }),
  outlineNode('task 3', { status: 'todo' })
]

async function resetOutline(app, outline = []) {
  await app.resetOutline(outline)
}

async function waitForOutline(request, app) {
  const response = await request.get(`${app.apiUrl}/api/outline`)
  expect(response.ok(), 'outline fetch should succeed').toBeTruthy()
  return response.json()
}

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

async function createBaseContent(page, request, app) {
  await ensureBackendReady(request, app)
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    return text?.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000 }).not.toBe('loading')
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    const imgDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuwB9oRNgB8AAAAASUVORK5CYII='
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', attrs: { status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'task 1' }] }] },
            { type: 'listItem', attrs: { status: 'todo' }, content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'task 2' }] },
              { type: 'codeBlock', content: [{ type: 'text', text: 'console.log("hi")' }] },
              { type: 'paragraph', content: [{ type: 'image', attrs: { src: imgDataUri, alt: 'img' } }] },
              { type: 'bulletList', content: [
                { type: 'listItem', attrs: { status: 'todo' }, content: [ { type: 'paragraph', content: [{ type: 'text', text: 'sub a' }] } ] }
              ] }
            ] },
            { type: 'listItem', attrs: { status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'task 3' }] }] }
          ]
        }
      ]
    }
    editor.commands.setContent(doc)
  })

  await expect(page.locator('li.li-node')).toHaveCount(4)
  await expect(page.locator('code')).toHaveCount(1)
  await expectOutlineState(page, clipboardBaseState(), { includeTags: false })
}

test.beforeEach(async ({ app }) => {
  await resetOutline(app)
})

test('select-all copy -> delete -> paste preserves outline structure/content', async ({ page, request, app }, testInfo) => {
  await createBaseContent(page, request, app)

  const editor = page.locator('.tiptap.ProseMirror')
  await editor.click()
  const saveIndicator = page.locator('.save-indicator').first()
  await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT })

  await expect(page.locator('li.li-node')).toHaveCount(4)
  const preCodeCount = await page.locator('code').count()
  const preImgCount = await page.locator('li.li-node img').count()
  expect(preCodeCount).toBeGreaterThanOrEqual(1)
  expect(preImgCount).toBeGreaterThanOrEqual(1)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
  await page.keyboard.press('Backspace')
  await expect(saveIndicator).toHaveText(/Unsaved changes|Saving…/, { timeout: SHORT_TIMEOUT })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
  await expect(saveIndicator).toHaveText(/Unsaved changes|Saving…/, { timeout: SHORT_TIMEOUT })
  await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT })

  await expect(page.locator('li.li-node')).toHaveCount(4)
  await expect(page.locator('code')).toHaveCount(preCodeCount)
  await expect(page.locator('li.li-node img')).toHaveCount(preImgCount)
  await expectOutlineState(page, clipboardBaseState(), { includeTags: false })

  await expect.poll(async () => {
    const data = await waitForOutline(request, app)
    const roots = data.roots || []
    const titles = roots.map(n => n.title)
    return { count: roots.length, titles }
  }, { message: 'outline titles should be preserved', timeout: 15000 }).toEqual({ count: 3, titles: ['task 1','task 2','task 3'] })
})
