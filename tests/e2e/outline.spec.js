const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })
const path = require('path')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4175'
const TEST_IMAGE = path.join(__dirname, '..', 'assets', 'test-image.png')

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, {
    data: { outline: [] }
  })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

async function waitForOutline(request) {
  const response = await request.get(`${API_URL}/api/outline`)
  expect(response.ok(), 'outline fetch should succeed').toBeTruthy()
  return response.json()
}

async function expectOutlineTitles(request, expectedTitles) {
  await expect.poll(async () => {
    const data = await waitForOutline(request)
    return (data.roots || []).map(node => node.title)
  }, { message: 'outline titles should match expected order' }).toEqual(expectedTitles)
}

test.beforeEach(async ({ request }) => {
  await resetOutline(request)
})

async function ensureBackendReady(request) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${API_URL}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch (err) {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function createThreeTasks(page, request) {
  await ensureBackendReady(request)
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    return text?.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000 }).not.toBe('loading')
  const listItems = page.locator('li.li-node')
  await expect(listItems.first()).toBeVisible()

  const firstParagraph = listItems.first().locator('p').first()
  await firstParagraph.click()
  await page.evaluate(() => {
    const paragraph = document.querySelector('li.li-node p')
    if (!paragraph) return
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.type('task 1')
  await expect(listItems.nth(0)).toContainText('task 1')

  await page.keyboard.press('Enter')
  await expect(listItems).toHaveCount(2)

  await page.keyboard.type('task 2')
  await expect(listItems.nth(1)).toContainText('task 2')

  await page.keyboard.press('Enter')
  await expect(listItems).toHaveCount(3)

  await page.keyboard.type('task 3')
  await expect(listItems.nth(2)).toContainText('task 3')
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

function extractBodyNodes(node) {
  if (!node) return []
  if (Array.isArray(node.body)) return node.body
  if (typeof node.content === 'string') {
    try {
      const parsed = JSON.parse(node.content)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  if (Array.isArray(node.content)) return node.content
  return []
}

function countNodeType(nodes, type) {
  if (!Array.isArray(nodes)) return 0
  let total = 0
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    if (node.type === type) total += 1
    if (Array.isArray(node.content)) total += countNodeType(node.content, type)
  }
  return total
}

test('create task 1, task 2, and task 3', async ({ page, request }) => {
  await createThreeTasks(page, request)

  const items = page.locator('li.li-node')
  await expect(items.nth(0)).toContainText('task 1')
  await expect(items.nth(1)).toContainText('task 2')
  await expect(items.nth(2)).toContainText('task 3')

  await expectOutlineTitles(request, ['task 1', 'task 2', 'task 3'])
})

test('insert code block into task 2 via slash command', async ({ page, request }) => {
  await createThreeTasks(page, request)

  const secondItem = page.locator('li.li-node').nth(1)
  await secondItem.locator('p').first().click()
  await placeCaretAtTaskEnd(page, 1)

  await page.keyboard.type('/')
  await expect(page.locator('.slash-menu')).toBeVisible()
  await page.locator('.slash-menu button', { hasText: 'Code block' }).click()

  await expect(page.locator('.slash-menu')).toHaveCount(0)
  await expect(page.locator('li.li-node')).toHaveCount(3, { timeout: 10000 })
  await expect(secondItem).toContainText('task 2')
  await expect(secondItem.locator('code')).toHaveCount(1)
  await expect(page.locator('li.li-node').nth(2)).toContainText('task 3')

  await expect.poll(async () => {
    const data = await waitForOutline(request)
    const nodes = data.roots || []
    return {
      titles: nodes.map(node => node.title),
      codeBlocks: nodes.map(node => countNodeType(extractBodyNodes(node), 'codeBlock'))
    }
  }, { message: 'outline should persist code block within second task' }).toEqual({
    titles: ['task 1', 'task 2', 'task 3'],
    codeBlocks: [0, 1, 0]
  })
})

test('upload image into task 2 via slash command', async ({ page, request }) => {
  await createThreeTasks(page, request)

  const secondItem = page.locator('li.li-node').nth(1)
  await secondItem.locator('p').first().click()
  await placeCaretAtTaskEnd(page, 1)

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.keyboard.type('/')
  await expect(page.locator('.slash-menu')).toBeVisible()
  await page.locator('.slash-menu button', { hasText: 'Upload image' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(TEST_IMAGE)

  await expect(page.locator('li.li-node img').first()).toBeVisible()
  await expect(page.locator('li.li-node')).toHaveCount(3)

  await expect.poll(async () => {
    const data = await waitForOutline(request)
    const nodes = data.roots || []
    const imageBlocks = nodes.map(node => countNodeType(extractBodyNodes(node), 'image'))
    return {
      titles: nodes.map(node => node.title),
      imageTotal: imageBlocks.reduce((sum, count) => sum + count, 0)
    }
  }, { message: 'outline should persist a single image in the outline', timeout: 10000 }).toEqual({
    titles: ['task 1', 'task 2', 'task 3'],
    imageTotal: 1
  })
})



test('insert today date inline via slash command', async ({ page, request }) => {
  await createThreeTasks(page, request)

  const secondItem = page.locator('li.li-node').nth(1)
  await secondItem.locator('p').first().click()
  await placeCaretAtTaskEnd(page, 1)

  await page.keyboard.type('/')
  await expect(page.locator('.slash-menu')).toBeVisible()
  await page.locator('.slash-menu button', { hasText: 'Date worked on (today)' }).click()

  const today = new Date().toISOString().slice(0, 10)
  await expect(secondItem).toContainText(`@${today}`)
  await expect(page.locator('li.li-node').nth(2)).not.toContainText(`@${today}`)
  await expect(page.locator('li.li-node')).toHaveCount(3)
})
