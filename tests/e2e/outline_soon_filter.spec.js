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

function seedOutlineWithSoon() {
  return [
    {
      id: null,
      title: 'soon parent @soon',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: [
        { id: null, title: 'soon child', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon child' }] }], children: [] }
      ]
    },
    { id: null, title: 'normal task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'normal' }] }], children: [] }
  ]
}

test('outline has Soon filter that hides/shows @soon items and persists', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  const outline = seedOutlineWithSoon()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  await expect(page.getByRole('textbox')).toBeVisible()

  // By default, soon items visible
  await expect(page.getByText('soon parent')).toBeVisible()
  await expect(page.getByText('soon child')).toBeVisible()
  await expect(page.getByText('normal')).toBeVisible()

  // Toggle Soon off in Outline filter bar
  const soonToggle = page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill')
  await soonToggle.click()
  await expect(soonToggle).not.toHaveClass(/active/)

  // Soon items hidden, normal remains
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll('li.li-node[data-soon="1"]'))
      if (lis.length === 0) return false
      return lis.every(li => li.classList.contains('filter-hidden') || (li.style && li.style.display === 'none'))
    })
  }, { timeout: 5000 }).toBe(true)
  await expect(page.getByText('normal')).toBeVisible()

  // Reload and ensure persisted
  await page.reload()
  await expect(page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill')).not.toHaveClass(/active/)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll('li.li-node[data-soon="1"]'))
      if (lis.length === 0) return false
      return lis.every(li => li.classList.contains('filter-hidden') || (li.style && li.style.display === 'none'))
    })
  }, { timeout: 5000 }).toBe(true)
  await expect(page.getByText('normal')).toBeVisible()

  // Toggle Soon on again
  await page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill').click()
  await expect(page.locator('.status-filter-bar:not([data-timeline-filter]) .soon-toggle .btn.pill')).toHaveClass(/active/)
  await expect(page.getByText('soon parent')).toBeVisible()
})

