const { test, expect } = require('@playwright/test')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4100'

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
  await expect(page.locator('li.li-node').first()).toBeVisible()
}

function statusOf(li) {
  return li.getAttribute('data-status')
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
  await expect(firstLi).toHaveAttribute('data-status', 'done')

  // Press Enter to create next item
  await page.keyboard.press('Enter')

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toHaveAttribute('data-status', '')
})

async function createParentWithChild(page, { parentTitle = 'Parent', childTitle = 'Child A' } = {}) {
  await typeIntoFirstItem(page, parentTitle)
  await page.keyboard.press('Enter')
  await page.keyboard.type(childTitle)
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
  await expect(children).toHaveCount(2)
  await expect(children.nth(1)).toHaveAttribute('data-status', '')
})

test('Enter at beginning of child inserts preceding child sibling', async ({ page }) => {
  await openOutline(page)
  await createParentWithChild(page)

  await setSelectionToParagraph(page, 'Child A', { position: 'start' })

  await page.keyboard.press('Enter')

  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2)
  await expect(children.first()).toHaveAttribute('data-status', '')
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

test('Enter at end of parent creates new parent sibling and moves child under it', async ({ page }) => {
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
  const firstRoot = allNodes.nth(rootIndexes[0])
  await expect(firstRoot.locator('li.li-node')).toHaveCount(0)

  const secondRoot = allNodes.nth(rootIndexes[1])
  await expect(secondRoot).toHaveAttribute('data-status', '')

  const secondRootChildren = secondRoot.locator('li.li-node')
  await expect(secondRootChildren).toHaveCount(1)
  await expect(secondRootChildren.first()).toContainText('Child A')
  await expect(secondRootChildren.first()).toHaveAttribute('data-status', '')
})
