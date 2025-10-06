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
  await resetOutline(request, buildOutline(80))

  await page.goto('/')
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(80)

  await rows.first().locator('p').first().click()

  await page.evaluate(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' })
  })
  await page.waitForTimeout(150)

  const targetRow = rows.nth(79)
  const targetId = await targetRow.getAttribute('data-id')
  await targetRow.locator('p').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(50)

  const beforeScrollY = await page.evaluate(() => Math.round(window.scrollY))
  expect(beforeScrollY).toBeGreaterThan(200)

  const statusButton = targetRow.locator('button.status-chip')
  await statusButton.click()

  await expect(targetRow).toHaveAttribute('data-status', 'todo')
  await page.waitForTimeout(50)

  const { afterScrollY, anchorListId, viewportHeight } = await page.evaluate(() => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    const listItem = element?.closest('li.li-node')
    return {
      afterScrollY: Math.round(window.scrollY),
      anchorListId: listItem?.getAttribute('data-id') || null,
      viewportHeight: window.innerHeight || 0
    }
  })
  expect(anchorListId).toBe(targetId)

  const rectAfter = await targetRow.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom)
    }
  })
  expect(rectAfter.top).toBeGreaterThanOrEqual(-20)
  expect(rectAfter.bottom).toBeLessThanOrEqual(viewportHeight + 20)
})
