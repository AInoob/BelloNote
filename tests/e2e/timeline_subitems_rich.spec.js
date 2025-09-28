const { test, expect } = require('./test-base')

let API_URL = null

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

async function seedOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
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

test.beforeEach(async ({ request, app }) => { API_URL = app.apiUrl; await resetOutline(request) })

// Parent has date; children have rich content (code block, image)
// Expectation: Timeline shows parent with @date, and shows child code block text and an <img> element
// Timeline uses the same Outliner renderer, so body content should be visible.
test('timeline shows rich content from subtasks under a dated parent', async ({ page, request }) => {
  const today = todayStr()

  await seedOutline(request, [
    {
      title: 'Parent Dated', status: 'in-progress', dates: [today],
      children: [
        {
          title: 'Child Code',
          body: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Code context' }] },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const n = 7\nconsole.info(n*n)' }] }
          ]
        },
        {
          title: 'Child Image',
          body: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Image below' }] },
            { type: 'image', attrs: { src: 'https://via.placeholder.com/1' } }
          ]
        }
      ]
    }
  ])

  await openTimeline(page)

  const section = sectionByDate(page, today)
  await expect(section).toHaveCount(1)
  const scope = section.locator('.history-inline-preview')

  // Parent has @date
  await expect(scope).toContainText('Parent Dated')
  await expect(scope).toContainText(`@${today}`)

  // Subtasks content visible (titles may not be echoed when body is provided)
  await expect(scope).toContainText('Code context')
  await expect(scope).toContainText('Image below')

  // Code block text from child
  await expect(scope).toContainText('const n = 7')
  await expect(scope).toContainText('console.info(n*n)')
  await expect(scope.locator('pre')).toHaveCount(1)

  // Image element exists under the section (load success not required)
  await expect(scope.locator('img')).toHaveCount(1)
})

