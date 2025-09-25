const { test, expect } = require('./test-base')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4100'
const SHORT_TIMEOUT = 1000

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok()).toBeTruthy()
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible({ timeout: SHORT_TIMEOUT })
}

async function typeIntoFirstItem(page, text) {
  const first = page.locator('li.li-node').first()
  await first.locator('p').first().click()
  await page.evaluate(() => {
    const p = document.querySelector('li.li-node p')
    const r = document.createRange(); r.selectNodeContents(p)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  await page.keyboard.type(text)
}

test.beforeEach(async ({ request }) => { await resetOutline(request) })

// 1) New sibling should start with todo regardless of previous status
test('Enter creates a new item with status todo even if previous is done', async ({ page }) => {
  await openOutline(page)

  // Make first item 'done'
  const firstLi = page.locator('li.li-node').first()
  await typeIntoFirstItem(page, 'First')
  const statusBtn = firstLi.locator('.status-chip')
  await statusBtn.click() // empty -> todo
  await statusBtn.click() // todo -> in-progress
  await statusBtn.click() // in-progress -> done
  await expect(firstLi).toHaveAttribute('data-status', 'done', { timeout: SHORT_TIMEOUT })

  // Press Enter to create next item
  await page.keyboard.press('Enter')

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(items.nth(1)).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
})

async function createParentWithChild(page, { parentTitle = 'Parent', childTitle = 'Child A' } = {}) {
  await typeIntoFirstItem(page, parentTitle)
  const items = page.locator('li.li-node')
  await page.keyboard.press('Enter')
  await expect(items).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await items.nth(1).locator('p').first().click()
  await page.keyboard.type(childTitle)
  await expect(items.nth(1)).toContainText(childTitle, { timeout: SHORT_TIMEOUT })
  await page.keyboard.press('Tab')
}

async function setSelectionToParagraph(page, text, { position = 'end' } = {}) {
  await page.evaluate(({ text, position }) => {
    const editor = window.__WORKLOG_EDITOR
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
        const contentSize = paragraph.content.size
        const offset = position === 'start' ? 0 : contentSize
        anchor = paragraphPos + 1 + offset
        return false
      }
      return undefined
    })
    if (anchor === null) throw new Error(`Paragraph with text "${text}" not found`)
    editor.commands.focus()
    editor.commands.setTextSelection({ from: anchor, to: anchor })
  }, { text, position })
}

test('Enter at end of child inserts next sibling child with empty status', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page)

  await setSelectionToParagraph(page, 'Child A', { position: 'end' })

  await page.keyboard.press('Enter')

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(children.nth(1)).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
})

test('Enter at beginning of child inserts preceding child sibling', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page)

  await setSelectionToParagraph(page, 'Child A', { position: 'start' })

  await page.keyboard.press('Enter')

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(children.first()).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
})

async function findRootIndexes(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('li.li-node'))
    return nodes.reduce((acc, li, index) => {
      const parentListItem = li.parentElement?.closest?.('li.li-node') || null
      if (!parentListItem) acc.push(index)
      return acc
    }, [])
  })
}

test('Enter at end of parent creates new parent sibling and keeps child with original', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page, { parentTitle: 'Parent A', childTitle: 'Child A' })

  await setSelectionToParagraph(page, 'Parent A', { position: 'end' })

  await page.keyboard.press('Enter')

  let rootIndexes = []
  await expect.poll(async () => {
    rootIndexes = await findRootIndexes(page)
    return rootIndexes.length
  }).toBe(2)

  const allNodes = page.locator('li.li-node')
  const secondRoot = allNodes.nth(rootIndexes[1])
  await secondRoot.locator('p').first().click()

  const debugDoc = await page.evaluate(() => window.__WORKLOG_EDITOR?.getJSON?.())
  console.log('doc after enter (expanded)', JSON.stringify(debugDoc, null, 2))

  const firstRoot = allNodes.nth(rootIndexes[0])
  await expect(firstRoot.locator('li.li-node')).toHaveCount(1, { timeout: SHORT_TIMEOUT })
  await expect(firstRoot.locator('li.li-node').first()).toContainText('Child A', { timeout: SHORT_TIMEOUT })

  await expect(secondRoot).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
  await expect(secondRoot.locator('li.li-node')).toHaveCount(0)
})

test('Enter at end of collapsed parent keeps children under original task', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page, { parentTitle: 'Parent Collapsed', childTitle: 'Child 1' })

  await expect(page.locator('li.li-node p', { hasText: 'Parent Collapsed' }).first()).toBeVisible({ timeout: SHORT_TIMEOUT })
  await setSelectionToParagraph(page, 'Parent Collapsed', { position: 'end' })

  const parent = page.locator('li.li-node', { hasText: 'Parent Collapsed' }).first()
  await parent.locator('.caret.drag-toggle').first().click()
  await expect(parent).toHaveClass(/collapsed/, { timeout: SHORT_TIMEOUT })

  await setSelectionToParagraph(page, 'Parent Collapsed', { position: 'end' })
  await parent.locator('p').first().click()

  const collapsedAttr = await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR
    if (!editor) return null
    const { $from } = editor.view.state.selection
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth)
      if (node?.type?.name === 'listItem') {
        return node.attrs?.collapsed ?? null
      }
    }
    return null
  })
  expect(collapsedAttr).toBe(true)

  const childStructure = await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR
    if (!editor) return null
    const { $from } = editor.view.state.selection
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth)
      if (node?.type?.name === 'listItem') {
        return {
          childCount: node.childCount,
          childTypes: Array.from({ length: node.childCount }, (_, idx) => node.child(idx).type.name)
        }
      }
    }
    return null
  })
  console.log('collapsed child structure', childStructure)

  await page.keyboard.press('Enter')
  await expect.poll(async () => {
    const rootCount = await page.evaluate(() => {
      const doc = window.__WORKLOG_EDITOR?.getJSON?.()
      if (!doc) return 0
      const top = doc.content?.[0]
      if (!top || top.type !== 'bulletList') return 0
      return (top.content || []).length
    })
    return rootCount
  }, { timeout: SHORT_TIMEOUT }).toBe(2)
  const rootNodes = await findRootIndexes(page)
  const newRoot = page.locator('li.li-node').nth(rootNodes[1])
  await newRoot.locator('p').first().click()
  await page.keyboard.type('Parent Sibling')

  const sibling = page.locator('li.li-node', { hasText: 'Parent Sibling' }).first()
  await expect(sibling).toBeVisible({ timeout: SHORT_TIMEOUT })

  // Expand original parent and ensure the child remains attached
  await parent.locator('.caret.drag-toggle').first().click()
  const parentChildren = parent.locator('li.li-node')
  await expect(parentChildren).toHaveCount(1, { timeout: SHORT_TIMEOUT })
  await expect(parentChildren.first()).toContainText('Child 1', { timeout: SHORT_TIMEOUT })
  await expect(sibling.locator('li.li-node')).toHaveCount(0)
})

test('Enter on empty task creates a new task and focuses it', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Task 1')
  await page.keyboard.press('Enter')

  const itemsAfterFirstEnter = page.locator('li.li-node')
  await expect(itemsAfterFirstEnter).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(itemsAfterFirstEnter.first()).toContainText('Task 1', { timeout: SHORT_TIMEOUT })
  await expect(itemsAfterFirstEnter.nth(1)).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })

  await page.keyboard.press('Enter')

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(3, { timeout: SHORT_TIMEOUT })
  await expect(items.first()).toContainText('Task 1', { timeout: SHORT_TIMEOUT })

  const newItem = items.nth(2)
  await newItem.locator('p').first().click()
  await page.keyboard.type('Task 2')
  await expect(newItem).toContainText('Task 2', { timeout: SHORT_TIMEOUT })
})
