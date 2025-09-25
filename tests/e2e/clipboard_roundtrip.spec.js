const { test, expect } = require('./test-base')
const path = require('path')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4175'
const TEST_IMAGE = path.join(__dirname, '..', 'assets', 'test-image.png')

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

async function waitForOutline(request) {
  const response = await request.get(`${API_URL}/api/outline`)
  expect(response.ok(), 'outline fetch should succeed').toBeTruthy()
  return response.json()
}

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

async function createBaseContent(page, request) {
  await ensureBackendReady(request)
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    return text?.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000 }).not.toBe('loading')
  // Programmatically set a complex outline with nesting, code block, and image
  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR
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

  // Sanity check: list should render at least 3 items
  await expect(page.locator('li.li-node')).toHaveCount(4)
  await expect(page.locator('code')).toHaveCount(1)
}

test.beforeEach(async ({ request }) => {
  await resetOutline(request)
})

test('select-all copy -> delete -> paste preserves outline structure/content', async ({ page, request }, testInfo) => {
  await createBaseContent(page, request)

  const editor = page.locator('.tiptap.ProseMirror')
  await editor.click()
  const saveIndicator = page.locator('.save-indicator')
  await expect(saveIndicator).toHaveText('Saved')

  // Pre-state assertions
  await expect(page.locator('li.li-node')).toHaveCount(4) // task1, task2, sub a, task3
  const preCodeCount = await page.locator('code').count()
  const preImgCount = await page.locator('li.li-node img').count()
  expect(preCodeCount).toBeGreaterThanOrEqual(1)
  expect(preImgCount).toBeGreaterThanOrEqual(1)

  // Select all, copy, delete, paste
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
  await page.keyboard.press('Backspace')
  await expect(saveIndicator).toHaveText(/Unsaved changes|Saving…/)
  // Immediately paste back from clipboard
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
  await expect(saveIndicator).toHaveText(/Unsaved changes|Saving…/)
  await expect(saveIndicator).toHaveText('Saved')

  // Post-state assertions (DOM)
  await expect(page.locator('li.li-node')).toHaveCount(4)
  await expect(page.locator('code')).toHaveCount(preCodeCount)
  await expect(page.locator('li.li-node img')).toHaveCount(preImgCount)

  // Post-state assertions (API)
  await expect.poll(async () => {
    const data = await waitForOutline(request)
    const roots = data.roots || []
    const titles = roots.map(n => n.title)
    return { count: roots.length, titles }
  }, { message: 'outline titles should be preserved', timeout: 15000 }).toEqual({ count: 3, titles: ['task 1','task 2','task 3'] })
})
