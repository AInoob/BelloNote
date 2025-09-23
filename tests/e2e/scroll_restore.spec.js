const { test, expect } = require('@playwright/test')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5231'

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function buildLongOutline(count = 40) {
  return Array.from({ length: count }, (_, index) => ({
    id: null,
    title: `Task ${index + 1}`,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Task ${index + 1}` }] }],
    children: []
  }))
}

test('reload restores previous scroll position', async ({ page, request }) => {
  await resetOutline(request, buildLongOutline(60))

  await page.goto('/')
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(60)

  const lastRow = rows.nth(59)
  await lastRow.locator('p').first().scrollIntoViewIfNeeded()
  await lastRow.locator('p').first().click()

  await page.evaluate(() => window.scrollBy(0, window.innerHeight))
  await page.waitForTimeout(200)
  const initialScroll = await page.evaluate(() => window.scrollY)
  expect(initialScroll).toBeGreaterThan(100)

  await page.reload()
  const rowsAfter = page.locator('li.li-node')
  await expect(rowsAfter.first()).toBeVisible()
  await page.waitForTimeout(300)
  const restoredScroll = await page.evaluate(() => window.scrollY)
  expect(Math.abs(restoredScroll - initialScroll)).toBeLessThanOrEqual(20)
})
