const { test, expect } = require('./test-base')

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
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'soon parent @soon' }] }],
      children: []
    },
    { id: null, title: 'normal task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'normal' }] }], children: [] }
  ]
}

test('outline shows a Soon badge for @soon items', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const outline = seedSoonOutline()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  const li = page.locator('li.li-node', { has: page.getByText('soon parent') })
  await expect(li).toBeVisible()
  await expect(li).toHaveAttribute('data-soon-self', '1')
  // Normal task should not be marked soon
  const liNormal = page.locator('li.li-node', { has: page.getByText('normal') })
  await expect(liNormal).not.toHaveAttribute('data-soon-self', '1')
})

