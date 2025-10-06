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
          attrs: { dataId: 'seed-parent', status: '', collapsed: false, archivedSelf: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent Task' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  attrs: { dataId: 'seed-child-a', status: '', collapsed: false, archivedSelf: false },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Child A' }] },
                    {
                      type: 'bulletList',
                      content: [
                        {
                          type: 'listItem',
                          attrs: { dataId: 'seed-grandchild', status: '', collapsed: false, archivedSelf: false },
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
                  attrs: { dataId: 'seed-child-b', status: '', collapsed: false, archivedSelf: false },
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
          attrs: { dataId: 'seed-sibling', status: '', collapsed: false, archivedSelf: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Sibling Task' }] }
          ]
        }
      ]
    }
  ]
}

const buildLinearDoc = (count = 40) => ({
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: Array.from({ length: count }, (_, index) => ({
        type: 'listItem',
        attrs: { dataId: `linear-${index + 1}`, status: '', collapsed: false, archivedSelf: false },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `Linear Task ${index + 1}` }] }
        ]
      }))
    }
  ]
})

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
  const debugRequestCount = await page.evaluate(() => window.__FOCUS_REQUEST_COUNT || 0)
  const debugRequestLast = await page.evaluate(() => window.__FOCUS_REQUEST_LAST || null)
  console.log('DEBUG REQUEST COUNT', debugRequestCount, debugRequestLast)
  await expect(page.locator('.focus-banner-title')).toHaveText(/Linear Task 35/)
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
  const debugFocusRequestInitial = await page.evaluate(() => ({ count: window.__FOCUS_REQUEST_COUNT || 0, last: window.__FOCUS_REQUEST_LAST || null }))
  console.log('DEBUG FOCUS REQUEST INITIAL', debugFocusRequestInitial)
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

test('Escape exits focus mode and restores outline position', async ({ page }) => {
  await openOutline(page)
  await setOutline(page, buildLinearDoc(60))

  const anchor = page.locator('li.li-node[data-id="linear-35"]').first()
  await anchor.scrollIntoViewIfNeeded()
  await page.waitForTimeout(50)

  const initialIds = await page.evaluate(() => Array.from(document.querySelectorAll('li.li-node')).slice(0,10).map(li => li.getAttribute('data-id')))
  console.log('DEBUG INITIAL IDS', initialIds)
  console.log('DEBUG URL', page.url())
  console.log('DEBUG BODY CLASS BEFORE', await page.locator('body').getAttribute('class'))
  const bannerBefore = await page.evaluate(() => {
    const el = document.querySelector('.focus-banner-title')
    return el ? el.textContent : null
  })
  console.log('DEBUG BANNER BEFORE', bannerBefore)
  console.log('DEBUG LOGS BEFORE', await page.evaluate(() => Array.isArray(window.__FOCUS_DEBUG_LOGS) ? window.__FOCUS_DEBUG_LOGS.slice() : []))

  const initialScroll = await page.evaluate(() => Math.round(window.scrollY))
  const anchorId = await anchor.getAttribute('data-id')

  await anchor.locator('.li-content p').first().click({ modifiers: [modifierKey] })
  await expect(page.locator('body')).toHaveClass(/focus-mode/)
  await page.waitForTimeout(50)
  const bannerText = await page.locator('.focus-banner-title').textContent()
  console.log('DEBUG BANNER TEXT', bannerText)
  const debugRequest = await page.evaluate(() => ({ count: window.__FOCUS_REQUEST_COUNT || 0, last: window.__FOCUS_REQUEST_LAST || null, total: window.__FOCUS_REQUEST_TOTAL || 0 }))
  console.log('DEBUG REQUEST', debugRequest)
  const debugStateId = await page.evaluate(() => window.__FOCUS_DEBUG_ID || null)
  console.log('DEBUG STATE ID', debugStateId)
  const debugRef = await page.evaluate(() => window.__FOCUS_REF_DEBUG || null)
  console.log('DEBUG REF', debugRef)
  const debugExitFn = await page.evaluate(() => typeof window.__WORKLOG_EXIT_FOCUS)
  console.log('DEBUG EXIT FN TYPE', debugExitFn)
  const scriptReady = await page.evaluate(() => window.__WORKLOG_FOCUS_HOTKEYS_READY || false)
  console.log('DEBUG SCRIPT READY', scriptReady)
  const debugLogs = await page.evaluate(() => Array.isArray(window.__FOCUS_DEBUG_LOGS) ? window.__FOCUS_DEBUG_LOGS.slice() : [])
  console.log('DEBUG FOCUS LOGS', debugLogs)
  const scriptInit = await page.evaluate(() => window.__FOCUS_SCRIPT_TRIGGERED || 0)
  console.log('DEBUG SCRIPT INIT', scriptInit)
  const allFocusKeys = await page.evaluate(() => Object.fromEntries(Object.entries(window).filter(([key]) => key.startsWith('__FOCUS'))))
  console.log('DEBUG WINDOW FOCUS KEYS', allFocusKeys)
  const domFocusRootId = await page.evaluate(() => {
    const el = document.querySelector('li.li-node.focus-root')
    return el ? el.getAttribute('data-id') : null
  })
  console.log('DEBUG DOM FOCUS ROOT', domFocusRootId)

  await page.evaluate(() => {
    window.__TEST_KEY_CAPTURE = 0
    window.addEventListener('keydown', () => { window.__TEST_KEY_CAPTURE += 1 }, { once: false })
  })

  await page.keyboard.press('Escape')
  const debugKeyCapture = await page.evaluate(() => window.__TEST_KEY_CAPTURE || 0)
  console.log('DEBUG KEY CAPTURE', debugKeyCapture)
  const debugCount = await page.evaluate(() => window.__FOCUS_EXIT_KEY_COUNT || 0)
  console.log('DEBUG ESC COUNT', debugCount)
  const debugKeydownTotal = await page.evaluate(() => window.__KEYDOWN_TOTAL || 0)
  console.log('DEBUG KEYDOWN TOTAL', debugKeydownTotal)
  const debugScript = await page.evaluate(() => window.__FOCUS_SCRIPT_TRIGGERED || 0)
  console.log('DEBUG SCRIPT TRIGGER', debugScript)
  const activeTag = await page.evaluate(() => (document.activeElement && document.activeElement.tagName) || null)
  console.log('DEBUG ACTIVE TAG', activeTag)
  const debugFocusRef = await page.evaluate(() => window.__FOCUS_ROOT_REF || null)
  console.log('DEBUG ROOT REF', debugFocusRef)

  await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  await expect(page).not.toHaveURL(/\?[^#]*focus=/)

  await expect.poll(async () => {
    const currentScroll = await page.evaluate(() => Math.round(window.scrollY))
    return Math.abs(currentScroll - initialScroll)
  }, { timeout: 2000 }).toBeLessThan(30)

  await expect.poll(async () => {
    const targetId = anchorId || 'linear-35'
    return page.evaluate((id) => {
      if (typeof document === 'undefined') return false
      const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape : ((value) => value.replace(/["\\]/g, '\\$&'))
      const el = document.querySelector(`li.li-node[data-id="${esc(id)}"]`)
      if (!(el instanceof HTMLElement)) return false
      const rect = el.getBoundingClientRect()
      const viewportHeight = window.innerHeight || 0
      return rect.top >= -40 && rect.top <= viewportHeight * 0.8
    }, targetId)
  }, { timeout: 2000 }).toBe(true)
})

test('modifier+[ exits focus mode', async ({ page }) => {
  await openOutline(page)
  await setOutline(page, nestedOutlineDoc)
  await expectOutlineState(page, buildNestedOutline())

  const parentParagraph = page.locator('li.li-node[data-id="seed-parent"] .li-content p').first()
  await parentParagraph.click({ modifiers: [modifierKey] })
  await expect(page.locator('body')).toHaveClass(/focus-mode/)

  await page.keyboard.press(`${modifierKey}+[`) // command/control + [ should exit focus

  await expect(page.locator('body')).not.toHaveClass(/focus-mode/)
  await expect(page).not.toHaveURL(/\?[^#]*focus=/)
})
