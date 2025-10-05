const { test, expect } = require('./test-base')

let API_URL = null

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

async function getTopTaskState(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('li.li-node[data-id]'))
    const candidate = nodes.find((node) => {
      const rect = node.getBoundingClientRect()
      return rect && Number.isFinite(rect.top) && rect.bottom > 0 && rect.height > 0
    }) || nodes[0]
    if (!candidate) return { id: null, offset: null, scrollY: window.scrollY }
    const rect = candidate.getBoundingClientRect()
    return {
      id: candidate.getAttribute('data-id'),
      offset: Number.isFinite(rect.top) ? rect.top : null,
      scrollY: window.scrollY
    }
  })
}

function buildLongOutline(count = 40) {
  return Array.from({ length: count }, (_, index) => ({
    id: null,
    title: `Task ${index + 1}`,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Task ${index + 1}` }] }],
    children: []
  }))
}

test.beforeEach(async ({ app }) => {
  API_URL = app.apiUrl;
})

test('reload restores top visible task', async ({ page, request }) => {
  await resetOutline(request, buildLongOutline(60))

  await page.goto('/')
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(60)

  const lastRow = rows.nth(59)
  await lastRow.locator('p').first().scrollIntoViewIfNeeded()
  await lastRow.locator('p').first().click()

  await page.evaluate(() => window.scrollBy(0, window.innerHeight))
  await page.waitForTimeout(200)
  const before = await getTopTaskState(page)
  expect(before.scrollY).toBeGreaterThan(100)
  expect(before.id).toBeTruthy()

  await page.reload()
  const rowsAfter = page.locator('li.li-node')
  await expect(rowsAfter.first()).toBeVisible()
  await page.waitForTimeout(300)
  const after = await getTopTaskState(page)
  expect(after.id).toBe(before.id)
  if (before.offset !== null && after.offset !== null) {
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(24)
  }
})

test('reload keeps top visible task for very long outlines (100 items)', async ({ page, request }) => {
  await resetOutline(request, buildLongOutline(100))

  await page.goto('/')
  const rows = page.locator('li.li-node')
  await expect(rows).toHaveCount(100)

  const targetRow = rows.nth(99)
  await targetRow.locator('p').first().scrollIntoViewIfNeeded()
  await targetRow.locator('p').first().click()

  await page.waitForTimeout(250)
  const before = await getTopTaskState(page)
  expect(before.scrollY).toBeGreaterThan(800)
  expect(before.id).toBeTruthy()

  await page.reload()
  const rowsAfter = page.locator('li.li-node')
  await expect(rowsAfter).toHaveCount(100)
  await page.waitForTimeout(300)

  const after = await getTopTaskState(page)
  expect(after.id).toBe(before.id)
  if (before.offset !== null && after.offset !== null) {
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(24)
  }

  const restoredRow = rowsAfter.nth(99)
  await expect(restoredRow).toBeVisible()
})

test('topbar remains visible while scrolling long outline', async ({ page, request }) => {
  await resetOutline(request, buildLongOutline(80))

  await page.goto('/')
  const topbar = page.locator('.topbar header')
  await expect(topbar).toBeVisible()

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }))
  await page.waitForTimeout(200)
  await expect(topbar).toBeVisible()
})
