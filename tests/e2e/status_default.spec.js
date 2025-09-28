
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

const settle = async (page, ms = 100) => { await page.waitForTimeout(ms) }

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

test.beforeEach(async ({ app }) => { await resetOutline(app, buildInitialOutline()) })

// 1) New sibling should start with todo regardless of previous status
test('Enter creates a new item with status todo even if previous is done', async ({ page, app }) => {
  await openOutline(page)
  await expectOutlineState(page, [outlineNode('Start here')])

  const firstLi = page.locator('li.li-node').first()
  await typeIntoFirstItem(page, 'First')
  const statusBtn = firstLi.locator('.status-chip')
  await statusBtn.click()
  await statusBtn.click()
  await statusBtn.click()
  await expect(firstLi).toHaveAttribute('data-status', 'done', { timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [outlineNode('First', { status: 'done' })])

  await setSelectionToParagraph(page, 'First', { position: 'end' })
  await page.keyboard.press('Enter')

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect.poll(async () => items.nth(1).getAttribute('data-status'), { timeout: SHORT_TIMEOUT }).toBe('')
  await expectOutlineState(page, [
    outlineNode('First', { status: 'done' }),
    outlineNode('')
  ])
})

test('splitting a task keeps neighbor statuses and clears the new item', async ({ page, request, app }) => {
  const outline = [
    {
      id: null,
      title: 'Task 1',
      status: 'in-progress',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task 1' }] }],
      children: []
    },
    {
      id: null,
      title: 'Task 2',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task 2' }] }],
      children: []
    }
  ]

  await resetOutline(app, outline)
  const verifyResponse = await request.get(`${app.apiUrl}/api/outline`)
  expect(verifyResponse.ok()).toBeTruthy()
  const verifyPayload = await verifyResponse.json()
  expect(verifyPayload.roots.map(({ title, status }) => ({ title, status }))).toEqual([
    { title: 'Task 1', status: 'in-progress' },
    { title: 'Task 2', status: 'todo' }
  ])

  const outlineFetch = page.waitForResponse(response => response.url().includes('/api/outline') && response.request().method() === 'GET')
  await openOutline(page)
  const uiOutlineResponse = await outlineFetch
  expect(uiOutlineResponse.ok()).toBeTruthy()
  const uiData = await uiOutlineResponse.json()
  expect(uiData.roots.map(({ title, status }) => ({ title, status }))).toEqual([
    { title: 'Task 1', status: 'in-progress' },
    { title: 'Task 2', status: 'todo' }
  ])

  await expectOutlineState(page, [
    outlineNode('Task 1', { status: 'in-progress' }),
    outlineNode('Task 2', { status: 'todo' })
  ])

  await setSelectionToParagraph(page, 'Task 1', { position: 'end' })
  await settle(page)

  await page.keyboard.press('Enter')
  await settle(page)
  await page.waitForTimeout(50)

  await expectOutlineState(page, [
    outlineNode('Task 1', { status: 'in-progress' }),
    outlineNode('', { status: '' }),
    outlineNode('Task 2', { status: 'todo' })
  ])
})

test('Enter at end of child inserts next sibling child with empty status', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page)
  await expectOutlineState(page, [
    outlineNode('Parent', {
      children: [outlineNode('Child A')]
    })
  ])

  await setSelectionToParagraph(page, 'Child A', { position: 'end' })
  await page.keyboard.press('Enter')

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect.poll(async () => children.nth(1).getAttribute('data-status'), { timeout: SHORT_TIMEOUT }).toBe('')
  await expectOutlineState(page, [
    outlineNode('Parent', {
      children: [
        outlineNode('Child A'),
        outlineNode('')
      ]
    })
  ])
})

test('Enter at beginning of child inserts preceding child sibling', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page)
  await expectOutlineState(page, [
    outlineNode('Parent', {
      children: [outlineNode('Child A')]
    })
  ])

  await setSelectionToParagraph(page, 'Child A', { position: 'start' })
  await page.keyboard.press('Enter')

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(children.first()).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [
    outlineNode('Parent', {
      children: [
        outlineNode(''),
        outlineNode('Child A')
      ]
    })
  ])
})

test('Enter at end of parent adds a new child and keeps existing children', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page, { parentTitle: 'Parent A', childTitle: 'Child A' })
  await expectOutlineState(page, [
    outlineNode('Parent A', {
      children: [outlineNode('Child A')]
    })
  ])

  await setSelectionToParagraph(page, 'Parent A', { position: 'end' })
  await page.keyboard.press('Enter')

  let rootIndexes = []
  await expect.poll(async () => {
    rootIndexes = await findRootIndexes(page)
    return rootIndexes.length
  }).toBe(1)

  const allNodes = page.locator('li.li-node')
  const parentNode = allNodes.nth(rootIndexes[0])
  const childNodes = parentNode.locator('li.li-node')
  await expect(childNodes).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(childNodes.first()).toContainText('Child A', { timeout: SHORT_TIMEOUT })
  await expect(childNodes.nth(1)).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [
    outlineNode('Parent A', {
      children: [
        outlineNode('Child A'),
        outlineNode('')
      ]
    })
  ])

  await expect.poll(() => page.evaluate(() => Boolean(window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR))).toBe(true)
  await expect.poll(() => page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    const { $from } = editor.state.selection
    return $from.parent?.textContent ?? null
  })).toBe('')

  await childNodes.nth(1).locator('p').first().click()
  await page.keyboard.type('Child B')
  await expect.poll(async () => childNodes.nth(1).getAttribute('data-body-text'), { timeout: SHORT_TIMEOUT }).toBe('Child B')
  await expectOutlineState(page, [
    outlineNode('Parent A', {
      children: [
        outlineNode('Child A'),
        outlineNode('Child B')
      ]
    })
  ])
})

test('Enter at end of collapsed parent keeps children under original task', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page, { parentTitle: 'Parent Collapsed', childTitle: 'Child 1' })
  await expectOutlineState(page, [
    outlineNode('Parent Collapsed', {
      children: [outlineNode('Child 1')]
    })
  ])

  await expect(page.locator('li.li-node p', { hasText: 'Parent Collapsed' }).first()).toBeVisible({ timeout: SHORT_TIMEOUT })
  await setSelectionToParagraph(page, 'Parent Collapsed', { position: 'end' })

  const parent = page.locator('li.li-node', { hasText: 'Parent Collapsed' }).first()
  await parent.locator('.caret.drag-toggle').first().click()
  await expect(parent).toHaveClass(/collapsed/, { timeout: SHORT_TIMEOUT })

  await setSelectionToParagraph(page, 'Parent Collapsed', { position: 'end' })
  await parent.locator('p').first().click()

  const collapsedAttr = await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
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

  await page.keyboard.press('Enter')
  await expectOutlineState(page, [
    outlineNode('Parent Collapsed', {
      children: [outlineNode('Child 1')]
    }),
    outlineNode('')
  ])
  const rootNodes = await findRootIndexes(page)
  const newRoot = page.locator('li.li-node').nth(rootNodes[1])
  await newRoot.locator('p').first().click()
  await page.keyboard.type('Parent Sibling')

  const sibling = page.locator('li.li-node', { hasText: 'Parent Sibling' }).first()
  await expect(sibling).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [
    outlineNode('Parent Collapsed', {
      children: [outlineNode('Child 1')]
    }),
    outlineNode('Parent Sibling')
  ])

  await parent.locator('.caret.drag-toggle').first().click()
  const parentChildren = parent.locator('li.li-node')
  await expect(parentChildren).toHaveCount(1, { timeout: SHORT_TIMEOUT })
  await expect(parentChildren.first()).toContainText('Child 1', { timeout: SHORT_TIMEOUT })
  await expect(sibling.locator('li.li-node')).toHaveCount(0)
  await expectOutlineState(page, [
    outlineNode('Parent Collapsed', {
      children: [outlineNode('Child 1')]
    }),
    outlineNode('Parent Sibling')
  ])
})

test('Enter on empty task creates a new task and focuses it', async ({ page }) => {
  await openOutline(page)
  await expectOutlineState(page, [outlineNode('Start here')])

  await typeIntoFirstItem(page, 'Task 1')
  await expectOutlineState(page, [outlineNode('Task 1')])
  await page.keyboard.press('Enter')

  const itemsAfterFirstEnter = page.locator('li.li-node')
  await expect(itemsAfterFirstEnter).toHaveCount(2, { timeout: SHORT_TIMEOUT })
  await expect(itemsAfterFirstEnter.first()).toContainText('Task 1', { timeout: SHORT_TIMEOUT })
  await expect(itemsAfterFirstEnter.nth(1)).toHaveAttribute('data-status', '', { timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode('')
  ])

  await page.keyboard.press('Enter')
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode(''),
    outlineNode('')
  ])

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(3, { timeout: SHORT_TIMEOUT })
  await expect(items.first()).toContainText('Task 1', { timeout: SHORT_TIMEOUT })

  const newItem = items.nth(2)
  await newItem.locator('p').first().click()
  await page.keyboard.type('Task 2')
  await expect(newItem).toContainText('Task 2', { timeout: SHORT_TIMEOUT })
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode(''),
    outlineNode('Task 2')
  ])
})

test('Tab after creating sibling indents next task without losing focus', async ({ page }) => {
  await openOutline(page)
  await page.evaluate(() => localStorage.setItem('WL_DEBUG', '1'))
  await expectOutlineState(page, [outlineNode('Start here')])

  await typeIntoFirstItem(page, 'Task 1')
  await expectOutlineState(page, [outlineNode('Task 1')])
  await page.keyboard.press('Enter')
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode('')
  ])
  await page.keyboard.type('Task 2')
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode('Task 2')
  ])

  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Task 3')
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode('Task 2', {
      children: [outlineNode('Task 3')]
    })
  ])
})

test('Enter then Tab from child keeps focus in new grandchild', async ({ page }) => {
  await openOutline(page)
  await expectOutlineState(page, [outlineNode('Start here')])

  await typeIntoFirstItem(page, 'Task 1')
  await expectOutlineState(page, [outlineNode('Task 1')])
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub task 1')
  await expectOutlineState(page, [
    outlineNode('Task 1'),
    outlineNode('Sub task 1')
  ])
  await page.keyboard.press('Tab')
  await expectOutlineState(page, [
    outlineNode('Task 1', {
      children: [outlineNode('Sub task 1')]
    })
  ])

  await setSelectionToParagraph(page, 'Sub task 1', { position: 'end' })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Sub sub task 1')
  await expectOutlineState(page, [
    outlineNode('Task 1', {
      children: [
        outlineNode('Sub task 1', {
          children: [outlineNode('Sub sub task 1')]
        })
      ]
    })
  ])
})
