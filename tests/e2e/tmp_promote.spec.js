const { test, expect } = require('./test-base')

let API_URL = null

async function resetOutline(request, outline = []) {
  const resp = await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(resp.ok()).toBeTruthy()
}

async function openOutline(page) {
  await page.goto('/')
  await page.waitForFunction(() => !!(window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR))
  const exitFocus = page.locator('.focus-banner button')
  if (await exitFocus.isVisible()) {
    await exitFocus.click()
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  }
}

async function setSelectionToParagraph(page, text) {
  const paragraphLocator = page.locator('li.li-node p', { hasText: text }).first()
  await paragraphLocator.click()
  await page.evaluate(({ text }) => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor missing')
    let anchor = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return undefined
      const paragraph = node.child(0)
      if (!paragraph || paragraph.type.name !== 'paragraph') return undefined
      if ((paragraph.textContent || '').trim() === text.trim()) {
        const paragraphStart = pos + 2
        anchor = paragraphStart + paragraph.content.size
        return false
      }
      return undefined
    })
    if (anchor === null) throw new Error(`Paragraph ${text} not found`)
    editor.chain().focus().setTextSelection({ from: anchor, to: anchor }).run()
  }, { text })
}

test.beforeEach(async ({ app }) => {
  API_URL = app.apiUrl;
})

test('split sibling promotes to child', async ({ page, request }) => {
  await resetOutline(request)
  const outline = [
    {
      id: null,
      title: 'Parent A',
      status: 'in-progress',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent A' }] }],
      children: [
        {
          id: null,
          title: 'Child A',
          status: 'todo',
          body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child A' }] }],
          children: []
        }
      ]
    },
    {
      id: null,
      title: 'Task 2',
      status: 'todo',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task 2' }] }],
      children: []
    }
  ]
  await resetOutline(request, outline)

  await openOutline(page)
  await page.waitForFunction(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) return false
    const doc = editor.getJSON()
    const list = doc.content?.find(node => node.type === 'bulletList')
    if (!list) return false
    return list.content?.some(item => {
      const para = item.content?.[0]
      if (!para || para.type !== 'paragraph') return false
      const text = (para.content || []).map(ch => ch.text || '').join('')
      return text.trim() === 'Parent A'
    })
  })

  await setSelectionToParagraph(page, 'Parent A')
  await page.keyboard.press('Enter')
  await expect.poll(async () => page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) return null
    const doc = editor.getJSON()
    const list = doc.content?.find(node => node.type === 'bulletList')
    if (!list) return null
    const parentItem = list.content?.find(item => item.content?.[0]?.content?.some(ch => ch.text === 'Parent A'))
    if (!parentItem) return null
    const nested = parentItem.content?.find(child => child.type === 'bulletList')
    if (!nested) return []
    return nested.content.map(item => {
      const paragraph = item.content?.[0]
      if (!paragraph || paragraph.type !== 'paragraph') return ''
      return (paragraph.content || []).map(ch => ch.text || '').join('')
    })
  }), { timeout: 5000, message: 'expected split item to spawn a blank child before editing' }).toEqual(['Child A', ''])

  const blankChildParagraph = page.locator('li.li-node[data-body-text=""]').first().locator('p')
  await expect(blankChildParagraph).toBeVisible()
  await blankChildParagraph.click()

  await page.keyboard.type('Child B')

  await expect.poll(async () => page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) return null
    const doc = editor.getJSON()
    const list = doc.content?.find(node => node.type === 'bulletList')
    if (!list) return null
    const parentItem = list.content?.find(item => item.content?.[0]?.content?.some(ch => ch.text === 'Parent A'))
    if (!parentItem) return null
    const nested = parentItem.content?.find(child => child.type === 'bulletList')
    if (!nested) return []
    return nested.content.map(item => {
      const paragraph = item.content?.[0]
      if (!paragraph || paragraph.type !== 'paragraph') return ''
      return (paragraph.content || []).map(ch => ch.text || '').join('')
    })
  }), { timeout: 5000, message: 'expected split item to promote to nested children' }).toEqual(['Child A', 'Child B'])
})
