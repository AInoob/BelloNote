const { test, expect } = require('@playwright/test')

// Ensure tests don't interfere with each other
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

async function waitForOutlineTitles(request) {
  const res = await request.get(`${ORIGIN}/api/outline`)
  expect(res.ok(), 'outline fetch should succeed').toBeTruthy()
  const data = await res.json()
  const roots = data.roots || []
  return roots.map(n => n.title)
}

async function setOutlineNormalized(request, outline) {
  const res = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(res.ok(), 'outline set should succeed').toBeTruthy()
}

function buildArchivedOutline() {
  return [
    {
      id: null,
      title: 'archived parent @archived',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'archived parent @archived' }] }],
      children: [
        {
          id: null,
          title: 'child A',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child A' }] }],
          children: []
        }
      ]
    },
    {
      id: null,
      title: 'active sibling',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'active sibling' }] }],
      children: []
    }
  ]
}

// This test ensures that archived dimming applies even on first load
// and that the Archived: Hidden toggle hides archived items (with descendants)

test('archived items are dimmed on initial load and hide when toggled', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  // Seed outline directly via API, then open the app (first load)
  await setOutlineNormalized(request, buildArchivedOutline())

  await page.goto('/')

  // Wait items render and NodeViews mount
  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(3)
  await expect(page.locator('li.li-node > .li-row .li-content')).toHaveCount(3)

  const archivedItem = items.nth(0)
  const childItem = items.nth(1)

  // On first load, applyStatusFilter should have run and set data-archived="1"
  await expect.poll(async () => await archivedItem.getAttribute('data-archived'), { timeout: 15000 })
    .toBe('1')
  await expect.poll(async () => await childItem.getAttribute('data-archived'), { timeout: 15000 })
    .toBe('1')

  // Toggle Archived: Hidden and expect the archived root to be hidden
  const archivedToggle = page.locator('.archive-toggle .btn.pill')
  await expect(archivedToggle).toBeVisible()

  const label = (await archivedToggle.textContent())?.trim()
  if (label === 'Shown') {
    await archivedToggle.click()
  }
  await expect.poll(async () => (await archivedToggle.textContent())?.trim(), { timeout: 5000 })
    .toBe('Hidden')

  await expect.poll(async () => await archivedItem.evaluate(el => el.classList.contains('filter-hidden') ? 'yes' : 'no'), {
    timeout: 5000
  }).toBe('yes')
})

