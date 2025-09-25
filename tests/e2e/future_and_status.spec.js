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

function seedFutureOutline() {
  return [
    {
      id: null,
      title: 'parent @future',
      status: 'todo',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'parent @future' }] }],
      children: [
        {
          id: null,
          title: 'child of future parent',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child of future parent' }] }],
          children: []
        }
      ]
    }
  ]
}

function seedStatusOutline() {
  return [
    {
      id: null,
      title: 'parent in progress',
      status: 'in-progress',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'parent in progress' }] }],
      children: [
        {
          id: null,
          title: 'child todo',
          status: 'todo',
          dates: [],
          ownWorkedOnDates: [],
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child todo' }] }],
          children: []
        }
      ]
    }
  ]
}

// 1) Future tag + filter: inheritance and toggle
test('future tag inheritance and filter toggle', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const outline = seedFutureOutline()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok(), 'outline set should succeed').toBeTruthy()

  await page.goto('/')

  // Find the two items by text
  const parentLi = page.locator('li.li-node', { hasText: 'parent @future' })
  const childLi = parentLi.locator(':scope li.li-node').first()
  await expect(parentLi).toBeVisible()
  await expect(childLi).toBeVisible()

  // Sanity: Future toggle should exist and default to Shown

  // Toggle Future: Hidden
  const futureToggle = page.locator('.status-filter-bar .future-toggle .btn.pill')
  await expect(futureToggle).toHaveClass(/active/)
  await futureToggle.click()
  await expect(futureToggle).not.toHaveClass(/active/)

  // When hidden, items with data-future=1 should not be visible
  await expect(parentLi).toBeHidden()
  await expect(childLi).toBeHidden()
})

// 2) Status color should not bleed from parent to child
// Parent in-progress (yellow), child todo (grey)
// We assert the computed background-color of the chips
test('status color does not bleed to child', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)
  const outline = seedStatusOutline()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(setRes.ok(), 'outline set should succeed').toBeTruthy()

  await page.goto('/')
  await page.waitForSelector('.status-chip.inline')

  const parentLi = page.locator('li.li-node', { hasText: 'parent in progress' }).first()
  await expect(parentLi).toBeVisible()
  const childLi = parentLi.locator(':scope li.li-node').filter({ hasText: 'child todo' }).first()
  await expect(childLi).toBeVisible()

  const childChipLocator = childLi.locator('> .li-row .status-chip.inline').first()
  const childBg = await childChipLocator.evaluate(el => getComputedStyle(el).backgroundColor)

  // Grey #e5e7eb -> rgb(229, 231, 235) for child todo (ensures no yellow bleed)
  expect(childBg).toBe('rgb(229, 231, 235)')
})
