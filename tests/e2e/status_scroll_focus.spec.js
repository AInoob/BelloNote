const { test, expect } = require('./test-base')

let API_URL = null

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, {
    data: { outline },
    headers: { 'x-playwright-test': '1' }
  })
  expect(response.ok()).toBeTruthy()
}

function buildOutline(count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    id: null,
    title: `Task ${index + 1}`,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Task ${index + 1}` }] }],
    children: []
  }))
}

test.beforeEach(async ({ app }) => {
  API_URL = app.apiUrl
})

test('toggling status keeps scroll position when caret is off-screen', async ({ page, request }) => {
  await page.addInitScript(() => {
    try { localStorage.clear() } catch {}
    try {
      window.__scrollAssignments = []
      window.__scrollIntoViewCalls = []
      const scrollingElement = document.scrollingElement || document.documentElement
      if (scrollingElement) {
        const proto = Object.getPrototypeOf(scrollingElement)
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'scrollTop')
        if (descriptor && typeof descriptor.set === 'function' && typeof descriptor.get === 'function') {
          Object.defineProperty(scrollingElement, 'scrollTop', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: function getScrollTop() {
              return descriptor.get.call(this)
            },
            set: function setScrollTop(value) {
              window.__scrollAssignments.push({ value, time: performance.now(), stack: new Error().stack })
              descriptor.set.call(this, value)
            }
          })
        }
      }
      const originalScrollIntoView = Element.prototype.scrollIntoView
      if (originalScrollIntoView) {
        Element.prototype.scrollIntoView = function patchedScrollIntoView(...args) {
          window.__scrollIntoViewCalls.push({
            tag: this.tagName,
            className: this.className,
            time: performance.now(),
            args,
            stack: new Error().stack
          })
          return originalScrollIntoView.apply(this, args)
        }
      }
    } catch {}
  })
  await resetOutline(request, buildOutline(80))

  await page.goto('/')
  await page.waitForTimeout(800)
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(80)

  await page.evaluate(() => {
    const original = window.scrollTo
    window.__scrollCalls = []
    window.scrollTo = (...args) => {
      window.__scrollCalls.push(args)
      return original.apply(window, args)
    }
    window.__scrollEvents = []
    window.addEventListener('scroll', () => {
      const active = document.activeElement
      window.__scrollEvents.push({
        time: performance.now(),
        scrollY: window.scrollY,
        activeTag: active ? active.tagName : null,
        activeClass: active ? active.className : null
      })
    }, { passive: true })
  })

  const firstRow = rows.first()
  await firstRow.locator('p').first().click()

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }))
  await page.waitForTimeout(150)

  const targetRow = rows.nth(79)
  await targetRow.locator('p').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(50)

  const rectBefore = await targetRow.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height)
    }
  })

  const beforeScrollY = await page.evaluate(() => Math.round(window.scrollY))
  expect(beforeScrollY).toBeGreaterThan(200)

  const statusButton = targetRow.locator('button.status-chip')
  await statusButton.click()

  await expect(targetRow).toHaveAttribute('data-status', 'todo')
  await page.waitForTimeout(50)

  const focusInfo = await page.evaluate(() => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement
    const listItem = anchorElement?.closest('li.li-node')
    return {
      activeTag: document.activeElement?.tagName || null,
      activeClasses: document.activeElement?.className || null,
      anchorNodeType: anchor?.nodeType || null,
      anchorListId: listItem?.getAttribute('data-id') || null,
      focusHasSelection: selection ? selection.rangeCount > 0 : false,
      selectionCollapsed: selection ? selection.isCollapsed : null,
      selectionTextLength: selection ? String(selection).length : null,
      scrollY: Math.round(window.scrollY)
    }
  })
  console.log('focus info', focusInfo)

  const initialScrollRecorded = await page.evaluate(() => window.__statusToggleInitialScroll)
  console.log('initial scroll from handler', initialScrollRecorded)

  const rectAfter = await targetRow.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height)
    }
  })
  console.log('row rect', { rectBefore, rectAfter })

  const scrollCalls = await page.evaluate(() => window.__scrollCalls)
  console.log('scroll calls', scrollCalls)
  const scrollEvents = await page.evaluate(() => window.__scrollEvents)
  console.log('scroll events', scrollEvents)
  const scrollAssignments = await page.evaluate(() => window.__scrollAssignments)
  console.log('scroll assignments', scrollAssignments)
  const scrollIntoViewCalls = await page.evaluate(() => window.__scrollIntoViewCalls)
  console.log('scrollIntoView calls', scrollIntoViewCalls)

  const afterScrollY = await page.evaluate(() => Math.round(window.scrollY))
  console.log('scroll delta', { beforeScrollY, afterScrollY })
  expect(Math.abs(afterScrollY - beforeScrollY)).toBeLessThanOrEqual(8)
})
