const { test, expect, expectOutlineState, outlineNode } = require('./test-base')

let API_URL = null
const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control'

const nestedOutlineDoc = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          attrs: { dataId: 'seed-parent', status: '', collapsed: false, archivedSelf: false, futureSelf: false, soonSelf: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent Task' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  attrs: { dataId: 'seed-child-a', status: '', collapsed: false, archivedSelf: false, futureSelf: false, soonSelf: false },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Child A' }] },
                    {
                      type: 'bulletList',
                      content: [
                        {
                          type: 'listItem',
                          attrs: { dataId: 'seed-grandchild', status: '', collapsed: false, archivedSelf: false, futureSelf: false, soonSelf: false },
                          content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'Grandchild' }] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  type: 'listItem',
                  attrs: { dataId: 'seed-child-b', status: '', collapsed: false, archivedSelf: false, futureSelf: false, soonSelf: false },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Child B' }] }
                  ]
                }
              ]
            }
          ]
        },
        {
          type: 'listItem',
          attrs: { dataId: 'seed-sibling', status: '', collapsed: false, archivedSelf: false, futureSelf: false, soonSelf: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Sibling Task' }] }
          ]
        }
      ]
    }
  ]
}

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible()
  const exitFocus = page.locator('.focus-banner button')
  if (await exitFocus.isVisible()) {
    await exitFocus.click()
    await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  }
}

async function setOutline(page, doc) {
  await page.evaluate((payload) => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor not ready')
    const clone = JSON.parse(JSON.stringify(payload))
    editor.commands.setContent(clone)
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href)
        if (url.searchParams.has('focus')) {
          url.searchParams.delete('focus')
          window.history.replaceState({ focus: null }, '', url)
        }
      } catch {}
    }
  }, doc)
}

const buildNestedOutline = () => [
  outlineNode('Parent Task', {
    children: [
      outlineNode('Child A', {
        children: [outlineNode('Grandchild')]
      }),
      outlineNode('Child B')
    ]
  }),
  outlineNode('Sibling Task')
]

test.beforeEach(async ({ request, app }) => {
  API_URL = app.apiUrl;
  await resetOutline(request)
})

test('focus mode isolates subtree and keeps collapse state per root', async ({ page }) => {
  await openOutline(page)
  await setOutline(page, nestedOutlineDoc)
  await expectOutlineState(page, buildNestedOutline())

  await expect(page.locator('li.li-node').filter({ hasText: 'Parent Task' }).first()).toBeVisible()
  await expect(page.locator('li.li-node').filter({ hasText: 'Sibling Task' }).first()).toBeVisible()
  await expect(page.locator('li.li-node').filter({ hasText: 'Grandchild' }).first()).toBeVisible()

  const parentLi = page.locator('li.li-node[data-id="seed-parent"]').first()
  await parentLi.locator('p', { hasText: 'Parent Task' }).first().click({ modifiers: [modifierKey] })

  await expect(page.locator('body')).toHaveClass(/focus-mode/)
  await expect(page.locator('.focus-banner-title')).toHaveText('Parent Task')
  const getGrandchildLocator = async () => {
    const id = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('li.li-node'))
      for (const li of nodes) {
        const paragraph = li.querySelector(':scope > .li-row .li-content p')
        if (paragraph && paragraph.textContent.trim() === 'Grandchild') return li.getAttribute('data-id')
      }
      return null
    })
    return id ? page.locator(`li.li-node[data-id="${id}"]`) : page.locator('li.li-node').filter({ hasText: /^Grandchild$/ }).first()
  }
  await page.waitForFunction(() => !!document.querySelector('li.li-node[data-focus-role="descendant"]'))
  let grandchildLocator = await getGrandchildLocator()
  await expect(grandchildLocator).toBeVisible()
  await expect(page.locator('li.li-node').filter({ hasText: 'Sibling Task' }).first()).toBeHidden()
  await expect(grandchildLocator).toBeVisible()
  await expect(page).toHaveURL(/\?[^#]*focus=/)

  const childId = await page.evaluate(() => {
    const root = document.querySelector('li.li-node.focus-root')
    const child = root?.querySelector(':scope li.li-node')
    return child?.getAttribute('data-id') || null
  })
  await page.evaluate((id) => {
    if (!id) return
    const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : ((value) => value.replace(/["\\]/g, '\\$&'))
    const caret = document.querySelector(`li.li-node[data-id="${esc(id)}"] button.caret`)
    caret?.click()
  }, childId)

  grandchildLocator = await getGrandchildLocator()
  await expect(grandchildLocator).toBeHidden()

  await page.goBack()

  await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  await expect(page.locator('li.li-node').filter({ hasText: 'Sibling Task' }).first()).toBeVisible()
  grandchildLocator = await getGrandchildLocator()
  await expect(grandchildLocator).toBeVisible()
  await expect(page).not.toHaveURL(/\?[^#]*focus=/)

  await page.goForward()

  await expect(page.locator('body')).toHaveClass(/focus-mode/)
  grandchildLocator = await getGrandchildLocator()
  await expect(grandchildLocator).toBeHidden()

  await page.locator('.focus-banner button').click()

  await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  await expect(page.locator('li.li-node').filter({ hasText: 'Sibling Task' }).first()).toBeVisible()
  await expect(page).not.toHaveURL(/\?[^#]*focus=/)
  await expectOutlineState(page, buildNestedOutline())
})

test('focus modifier advertising switches cursor to pointer while held', async ({ page }) => {
  await openOutline(page)
  await setOutline(page, nestedOutlineDoc)
  await expectOutlineState(page, buildNestedOutline())

  const editor = page.locator('.tiptap.ProseMirror')
  await editor.click({ position: { x: 10, y: 10 } })

  const parentMain = page.locator('li.li-node[data-id="seed-parent"] .li-main').first()
  await parentMain.hover()
  const initialCursor = await parentMain.evaluate(el => getComputedStyle(el).cursor)
  expect(initialCursor).not.toBe('pointer')

  await page.keyboard.down(modifierKey)
  await expect.poll(async () => page.evaluate(() => document.body.classList.contains('focus-shortcut-available'))).toBe(true)
  await parentMain.hover()
  await expect.poll(async () => parentMain.evaluate(el => getComputedStyle(el).cursor)).toBe('pointer')

  await page.keyboard.up(modifierKey)
  await expect.poll(async () => page.evaluate(() => document.body.classList.contains('focus-shortcut-available'))).toBe(false)
  await parentMain.hover()
  await expect.poll(async () => parentMain.evaluate(el => getComputedStyle(el).cursor)).not.toBe('pointer')
  await expectOutlineState(page, buildNestedOutline())
})

test('modifier click focuses any nesting level', async ({ page }) => {
  await openOutline(page)
  await setOutline(page, nestedOutlineDoc)
  await expectOutlineState(page, buildNestedOutline())

  const childParagraph = page.locator('li.li-node[data-id="seed-child-a"] .li-content p').first()
  await childParagraph.click({ modifiers: [modifierKey] })

  await expect(page.locator('body')).toHaveClass(/focus-mode/)
  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('li.li-node.focus-root')
    return root ? root.getAttribute('data-id') : null
  })).toBe('seed-child-a')
  await expect(page.locator('.focus-banner-title')).toHaveText('Child A')
  await expect(page).toHaveURL(/focus=seed-child-a/)
  await expect(page.locator('li.li-node[data-id="seed-grandchild"]').first()).toBeVisible()
  await expect(page.locator('li.li-node[data-id="seed-sibling"]').first()).toBeHidden()
  await expect(page.locator('li.li-node[data-id="seed-child-b"]').first()).toBeHidden()

  const grandchildParagraph = page.locator('li.li-node[data-id="seed-grandchild"] .li-content p').first()
  await grandchildParagraph.click({ modifiers: [modifierKey] })

  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('li.li-node.focus-root')
    return root ? root.getAttribute('data-id') : null
  })).toBe('seed-grandchild')
  await expect(page.locator('.focus-banner-title')).toHaveText('Grandchild')
  await expect(page).toHaveURL(/focus=seed-grandchild/)
  await expect(page.locator('li.li-node[data-id="seed-child-a"]').first()).toHaveAttribute('data-focus-role', 'ancestor')
  await expect(page.locator('li.li-node[data-id="seed-parent"]').first()).toHaveAttribute('data-focus-role', 'ancestor')
  await expect(page.locator('li.li-node[data-id="seed-grandchild"]').first()).toHaveAttribute('data-focus-role', 'root')
  await expectOutlineState(page, buildNestedOutline())
})
