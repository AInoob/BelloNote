
const { test, expect, expectOutlineState, expectOutlineApiState, outlineNode } = require('./test-base')

async function resetOutline(app) {
  await app.resetOutline([])
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

const buildFlatState = (titles) => titles.map(title => outlineNode(title))

const buildNestedState = (childrenTitles) => [
  outlineNode('Parent', {
    children: childrenTitles.map(title => outlineNode(title))
  })
]

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
  const initialState = buildFlatState(['task 1', 'task 2', 'task 3'])
  await expectOutlineState(page, initialState, { includeTags: false })
  await expectOutlineApiState(request, app, initialState, { includeTags: false })

  await dndBefore(page, items.nth(2), items.nth(0))
  const reorderedState = buildFlatState(['task 3', 'task 1', 'task 2'])
  await expectOutlineState(page, reorderedState, { includeTags: false })
  await expectOutlineApiState(request, app, reorderedState, { includeTags: false })

  const refreshedItems = page.locator('li.li-node')
  await dndAfter(page, refreshedItems.nth(0), refreshedItems.nth(2))
  await expectOutlineState(page, initialState, { includeTags: false })
  await expectOutlineApiState(request, app, initialState, { includeTags: false })
})

test('drag subtasks up and down within a parent', async ({ page, request, app }) => {
  await seedParentWithChildren(app, request, 'Parent', ['Child A', 'Child B', 'Child C'])
  await openOutline(page)

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const childLis = parentLi.locator('li.li-node')
  await expect(childLis).toHaveCount(3)
  const initialNestedState = buildNestedState(['Child A', 'Child B', 'Child C'])
  await expectOutlineState(page, initialNestedState, { includeTags: false })
  await expectOutlineApiState(request, app, initialNestedState, { includeTags: false })

  await dndBefore(page, childLis.nth(2), childLis.nth(0))
  const reorderedNested = buildNestedState(['Child C', 'Child A', 'Child B'])
  await expectOutlineState(page, reorderedNested, { includeTags: false })
  await expectOutlineApiState(request, app, reorderedNested, { includeTags: false })

  const childC = parentLi.locator('li.li-node', { hasText: 'Child C' }).first()
  const childB = parentLi.locator('li.li-node', { hasText: 'Child B' }).first()
  await dndAfter(page, childC, childB)
  await expectOutlineState(page, initialNestedState, { includeTags: false })
  await expectOutlineApiState(request, app, initialNestedState, { includeTags: false })
})
