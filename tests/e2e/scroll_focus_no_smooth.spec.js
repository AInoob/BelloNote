const { test, expect } = require('./test-base')

function buildLongOutline(count = 60) {
  return Array.from({ length: count }, (_, index) => ({
    id: null,
    title: `Task ${index + 1}`,
    status: '',
    dates: [],
    ownWorkedOnDates: [],
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Task ${index + 1}` }] }],
    children: []
  }))
}

test('focusing a task should not request smooth scrolling (prevents extra scroll momentum)', async ({ page, app }) => {
  await app.resetOutline(buildLongOutline(80))

  await page.goto('/')
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(80)

  await page.evaluate(() => {
    window.__PLAYWRIGHT_TEST__ = true
    window.__SCROLL_TO_CALLS__ = []
    const original = window.scrollTo.bind(window)
    window.scrollTo = (...args) => {
      try { window.__SCROLL_TO_CALLS__.push(args) } catch {}
      return original(...args)
    }
  })

  // Ensure we are scrolled away from the top so focus scrolling is meaningful.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }))
  await page.waitForTimeout(50)

  const target = rows.nth(30)
  await expect(target).toBeVisible()

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await target.click({ modifiers: [modifier] })

  await page.waitForTimeout(120)

  const smoothCalls = await page.evaluate(() => {
    const calls = Array.isArray(window.__SCROLL_TO_CALLS__) ? window.__SCROLL_TO_CALLS__ : []
    return calls.filter((args) => {
      const first = args?.[0]
      return first && typeof first === 'object' && first.behavior === 'smooth'
    }).length
  })
  expect(smoothCalls).toBe(0)
})


