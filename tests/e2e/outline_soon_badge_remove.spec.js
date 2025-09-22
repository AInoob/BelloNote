const { test, expect } = require('@playwright/test')

test.describe.configure({ mode: 'serial' })

const ORIGIN = process.env.PLAYWRIGHT_ORIGIN || 'http://127.0.0.1:4175'

async function ensureBackendReady(request) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${ORIGIN}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(request) {
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline: [] } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

function seedOutlineSoonOne() {
  return [
    { id: null, title: 'soon parent @soon', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }], children: [] }
  ]
}

test('outline soon badge/indicator is removed when @soon is removed', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  const outline = seedOutlineSoonOne()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  await expect(page.getByRole('textbox')).toBeVisible()

  // Verify Soon indicator present initially (attribute)
  const li = page.locator('li.li-node').first()
  await expect(li).toBeVisible()
  await expect(li).toHaveAttribute('data-soon-self', '1')

  // Edit to remove the trailing " @soon"
  const content = li.locator('.li-content')
  await content.click()
  await page.keyboard.press('End')
  // Backspace enough times to remove trailing " @soon"
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Backspace')
  }

  // Re-evaluate the first li after edit
  const liAfter = page.locator('li.li-node').first()
  // Ensure indicator removed (poll DOM directly to avoid stale locators)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return !!document.querySelector('li.li-node[data-soon-self="1"]')
    })
  }, { timeout: 5000 }).toBe(false)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return document.querySelectorAll('.tag-badge.soon').length
    })
  }, { timeout: 5000 }).toBe(0)
})

