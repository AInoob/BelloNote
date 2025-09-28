
const { test, expect } = require('./test-base')

async function resetOutline(app) {
  await app.resetOutline([])
}

async function waitForOutline(request, app) {
  const response = await request.get(`${app.apiUrl}/api/outline`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function expectRootOrder(request, app, titles) {
  await expect.poll(async () => {
    const data = await waitForOutline(request, app)
    return (data.roots || []).map(n => n.title)
  }, { timeout: 10000, message: 'root order should match' }).toEqual(titles)
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => (await editor.evaluate(el => el.textContent)).includes('Loading…') ? 'loading' : 'ready').toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible()
}

async function seedSimpleOutline(app, request, titles) {
  const outline = titles.map(t => ({ title: t }))
  const response = await request.post(`${app.apiUrl}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

async function seedParentWithChildren(app, request, parentTitle, childrenTitles) {
  const outline = [{ title: parentTitle, children: childrenTitles.map(t => ({ title: t })) }]
  const response = await request.post(`${app.apiUrl}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

function childTitlesFromOutline(json, parentTitle) {
  const parent = (json.roots || []).find(n => n.title === parentTitle)
  return (parent?.children || []).map(n => n.title)
}

async function primeDrag(handle) {
  await handle.evaluate(node => {
    const dt = new DataTransfer()
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    node.dispatchEvent(event)
  })
}

async function dndBefore(page, sourceLi, targetLi) {
  const handle = sourceLi.locator('.drag-toggle')
  await primeDrag(handle)
  const target = targetLi.locator('.li-row')
  await handle.dragTo(target, { targetPosition: { x: 10, y: 4 } })
}

async function dndAfter(page, sourceLi, targetLi) {
  const handle = sourceLi.locator('.drag-toggle')
  await primeDrag(handle)
  const target = targetLi.locator('.li-row')
  const h = await target.evaluate(el => el.getBoundingClientRect().height)
  const y = Math.max(4, Math.floor(h * 0.9))
  await handle.dragTo(target, { targetPosition: { x: 10, y } })
}

test.beforeEach(async ({ app }) => { await resetOutline(app) })

test('drag root items up and down reorders correctly', async ({ page, request, app }) => {
  await seedSimpleOutline(app, request, ['task 1', 'task 2', 'task 3'])
  await openOutline(page)

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(3)

  await dndBefore(page, items.nth(2), items.nth(0))
  await expect(items.nth(0)).toContainText('task 3')
  await expectRootOrder(request, app, ['task 3', 'task 1', 'task 2'])

  const items2 = page.locator('li.li-node')
  await dndAfter(page, items2.nth(0), items2.nth(2))
  await expect(page.locator('li.li-node').nth(2)).toContainText('task 3')
  await expectRootOrder(request, app, ['task 1', 'task 2', 'task 3'])
})

test('drag subtasks up and down within a parent', async ({ page, request, app }) => {
  await seedParentWithChildren(app, request, 'Parent', ['Child A', 'Child B', 'Child C'])
  await openOutline(page)

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const childLis = parentLi.locator('li.li-node')
  await expect(childLis).toHaveCount(3)

  await dndBefore(page, childLis.nth(2), childLis.nth(0))
  await expect.poll(async () => childTitlesFromOutline(await waitForOutline(request, app), 'Parent')).toEqual(['Child C', 'Child A', 'Child B'])

  const childC = parentLi.locator('li.li-node', { hasText: 'Child C' }).first()
  const childB = parentLi.locator('li.li-node', { hasText: 'Child B' }).first()
  await dndAfter(page, childC, childB)
  await expect.poll(async () => childTitlesFromOutline(await waitForOutline(request, app), 'Parent')).toEqual(['Child A', 'Child B', 'Child C'])
})
