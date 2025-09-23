const { test, expect } = require('@playwright/test')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4000'

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok()).toBeTruthy()
}

async function waitForOutline(request) {
  const response = await request.get(`${API_URL}/api/outline`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function expectRootOrder(request, titles) {
  await expect.poll(async () => {
    const data = await waitForOutline(request)
    return (data.roots || []).map(n => n.title)
  }, { timeout: 10000, message: 'root order should match' }).toEqual(titles)
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => (await editor.evaluate(el => el.textContent)).includes('Loading…') ? 'loading' : 'ready').toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible()
}

async function seedSimpleOutline(request, titles) {
  const outline = titles.map(t => ({ title: t }))
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

async function seedParentWithChildren(request, parentTitle, childrenTitles) {
  const outline = [{ title: parentTitle, children: childrenTitles.map(t => ({ title: t })) }]
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function childTitlesFromOutline(json, parentTitle) {
  const parent = (json.roots || []).find(n => n.title === parentTitle)
  return (parent?.children || []).map(n => n.title)
}

// Drag and drop helpers
async function primeDrag(handle) {
  await handle.evaluate(node => {
    const dt = new DataTransfer()
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    node.dispatchEvent(event)
  })
}

async function dndBefore(page, sourceLi, targetLi) {
  // Drop in upper part of target => before
  const handle = sourceLi.locator('.drag-toggle')
  await primeDrag(handle)
  const target = targetLi.locator('.li-row')
  await handle.dragTo(target, { targetPosition: { x: 10, y: 4 } })
}
async function dndAfter(page, sourceLi, targetLi) {
  // Compute height and drop near bottom => after
  const handle = sourceLi.locator('.drag-toggle')
  await primeDrag(handle)
  const target = targetLi.locator('.li-row')
  const h = await target.evaluate(el => el.getBoundingClientRect().height)
  const y = Math.max(4, Math.floor(h * 0.9))
  await handle.dragTo(target, { targetPosition: { x: 10, y } })
}

test.beforeEach(async ({ request }) => { await resetOutline(request) })

// Root reorder: drag up and drag down
test('drag root items up and down reorders correctly', async ({ page, request }) => {
  await seedSimpleOutline(request, ['task 1', 'task 2', 'task 3'])
  await openOutline(page)

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(3)

  // Drag task 3 up above task 1
  await dndBefore(page, items.nth(2), items.nth(0))
  await expect(items.nth(0)).toContainText('task 3')
  await expectRootOrder(request, ['task 3', 'task 1', 'task 2'])

  // Drag task 3 down after task 2
  // Re-query items after DOM update
  const items2 = page.locator('li.li-node')
  await dndAfter(page, items2.nth(0), items2.nth(2))
  await expect(page.locator('li.li-node').nth(2)).toContainText('task 3')
  await expectRootOrder(request, ['task 1', 'task 2', 'task 3'])
})

// Subtask reorder: within the same parent
test('drag subtasks up and down within a parent', async ({ page, request }) => {
  await seedParentWithChildren(request, 'Parent', ['Child A', 'Child B', 'Child C'])
  await openOutline(page)

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  // The child lis are nested under the parent. Select the first nested list of li.li-node under parent.
  const childLis = parentLi.locator('li.li-node')
  await expect(childLis).toHaveCount(3)

  // Drag Child C up above Child A
  await dndBefore(page, childLis.nth(2), childLis.nth(0))
  await expect.poll(async () => childTitlesFromOutline(await waitForOutline(request), 'Parent')).toEqual(['Child C', 'Child A', 'Child B'])

  // Drag Child C down after Child B
  const childC = parentLi.locator('li.li-node', { hasText: 'Child C' }).first()
  const childB = parentLi.locator('li.li-node', { hasText: 'Child B' }).first()
  await dndAfter(page, childC, childB)
  await expect.poll(async () => childTitlesFromOutline(await waitForOutline(request), 'Parent')).toEqual(['Child A', 'Child B', 'Child C'])
})
