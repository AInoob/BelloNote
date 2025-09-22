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

function seedSoonOutline() {
  return [
    {
      id: null,
      title: 'soon parent @soon',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: [
        {
          id: null,
          title: 'soon child',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon child task' }] }],
          children: []
        }
      ]
    }
  ]
}

async function openTimeline(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('.timeline')).toBeVisible()
}

// Soon toggle hides/shows Soon bucket

test('timeline soon toggle hides/shows Soon section', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  const outline = seedSoonOutline()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok()).toBeTruthy()

  await openTimeline(page)

  // Soon section initially visible
  const soonSection = page.locator('section', { has: page.locator('h3', { hasText: 'Soon' }) })
  await expect(soonSection).toBeVisible()
  await expect(soonSection).toContainText('soon parent')

  // Toggle Soon off
  const soonToggle = page.locator('[data-timeline-filter="1"] .soon-toggle .btn.pill')
  await expect(soonToggle).toHaveClass(/active/)
  await soonToggle.click()
  await expect(soonToggle).not.toHaveClass(/active/)
  await expect(page.locator('h3', { hasText: 'Soon' })).toHaveCount(0)

  // Toggle Soon on again
  await soonToggle.click()
  await expect(soonToggle).toHaveClass(/active/)
  await expect(page.locator('h3', { hasText: 'Soon' })).toBeVisible()
})

