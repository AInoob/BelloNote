const { test, expect } = require('@playwright/test')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4000'

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok()).toBeTruthy()
}

async function seedOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function fmt(d) { return d.toISOString().slice(0,10) }
function todayStr() { return fmt(new Date()) }

async function openTimeline(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.locator('.timeline')).toBeVisible({ timeout: 10000 })
}

function sectionByDate(page, dateStr) {
  return page.locator('.timeline > section').filter({ has: page.locator('h3', { hasText: dateStr }) })
}

test.beforeEach(async ({ request }) => { await resetOutline(request) })

test('timeline renders code block content for dated task', async ({ page, request }) => {
  const today = todayStr()

  // Seed a single dated task with a code block body
  await seedOutline(request, [
    {
      title: 'Code task', status: 'todo', dates: [today],
      body: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Some context above code' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'console.log(42)\nfunction add(a,b){return a+b}' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Below code' }] }
      ]
    }
  ])

  await openTimeline(page)

  const todaySection = sectionByDate(page, today)
  await expect(todaySection).toHaveCount(1)

  const scope = todaySection.locator('.history-inline-preview')
  // Verify code block text appears
  await expect(scope).toContainText('console.log(42)')
  await expect(scope).toContainText('function add(a,b){return a+b}')
  // Optional: ensure a <pre> exists for code block
  await expect(scope.locator('pre')).toHaveCount(1)
})

