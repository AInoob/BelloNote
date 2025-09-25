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

function buildChildArchivedOutline() {
  return [
    {
      id: null,
      title: 'parent stays bright',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'parent stays bright' }] }],
      children: [
        {
          id: null,
          title: 'child archived @archived',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child archived @archived' }] }],
          children: []
        }
      ]
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
  const archivedItem = page.locator('li.li-node', { hasText: 'archived parent @archived' }).first()
  const childItem = page.locator('li.li-node', { hasText: 'child A' }).first()
  await expect(archivedItem).toBeVisible({ timeout: 15000 })
  await expect(childItem).toBeVisible({ timeout: 15000 })

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

test('archived descendants do not dim parent rows', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  await setOutlineNormalized(request, buildChildArchivedOutline())
  await page.goto('/')

  const parent = page.locator('li.li-node', { hasText: 'parent stays bright' }).first()
  const child = page.locator('li.li-node', { hasText: 'child archived @archived' }).first()
  await expect(parent).toBeVisible({ timeout: 15000 })
  await expect(child).toBeVisible({ timeout: 15000 })

  await expect.poll(async () => await parent.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('0')
  await expect.poll(async () => await child.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('1')

  const parentOpacity = await parent.locator('> .li-row').evaluate(el => Number.parseFloat(getComputedStyle(el).opacity))
  const childOpacity = await child.locator('> .li-row').evaluate(el => Number.parseFloat(getComputedStyle(el).opacity))

  expect(parentOpacity).toBeGreaterThanOrEqual(0.96)
  expect(childOpacity).toBeLessThan(0.9)
})

test('hiding archived children does not hide the parent', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  await page.goto('/')

  const firstParagraph = page.locator('li.li-node p').first()
  await expect(firstParagraph).toBeVisible({ timeout: 15000 })
  await page.evaluate(() => {
    const paragraph = document.querySelector('li.li-node p')
    if (!paragraph) return
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.type('Parent stays bright')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Child archived @archived')

  const parent = page.locator('li.li-node', { hasText: 'Parent stays bright' }).first()
  const child = page.locator('li.li-node', { hasText: 'Child archived @archived' }).first()
  await expect(parent).toBeVisible({ timeout: 15000 })
  await expect(child).toBeVisible({ timeout: 15000 })

  await expect.poll(async () => await child.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('1')
  await expect.poll(async () => await parent.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('0')

  const archivedToggle = page.locator('.archive-toggle .btn.pill')
  await expect(archivedToggle).toBeVisible()
  const label = (await archivedToggle.textContent())?.trim()
  if (label === 'Shown') {
    await archivedToggle.click()
  }
  await expect.poll(async () => (await archivedToggle.textContent())?.trim(), { timeout: 5000 })
    .toBe('Hidden')

  await expect(child).toBeHidden()
  await expect(parent, 'parent should remain visible when only child is archived').toBeVisible()
  await expect.poll(async () => await parent.getAttribute('data-archived'), { timeout: 5000 }).toBe('0')
})
