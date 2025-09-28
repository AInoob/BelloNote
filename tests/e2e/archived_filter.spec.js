
const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const SHORT_TIMEOUT = 1000

async function ensureBackendReady(request, app) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${app.apiUrl}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(app, outline = []) {
  await app.resetOutline(outline)
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

test('archived items are dimmed on initial load and hide when toggled', async ({ page, request, app }) => {
  await ensureBackendReady(request, app)
  await resetOutline(app)
  await resetOutline(app, buildArchivedOutline())

  await page.goto('/')

  const archivedItem = page.locator('li.li-node', { hasText: 'archived parent @archived' }).first()
  const childItem = page.locator('li.li-node', { hasText: 'child A' }).first()
  await expect(archivedItem).toBeVisible({ timeout: 15000 })
  await expect(childItem).toBeVisible({ timeout: 15000 })

  await expect.poll(async () => await archivedItem.getAttribute('data-archived'), { timeout: 15000 })
    .toBe('1')
  await expect.poll(async () => await childItem.getAttribute('data-archived'), { timeout: 15000 })
    .toBe('1')

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

test('archived descendants do not dim parent rows', async ({ page, request, app }) => {
  await ensureBackendReady(request, app)
  await resetOutline(app)
  await resetOutline(app, buildChildArchivedOutline())
  await page.goto('/')

  const parent = page.locator('li.li-node[data-body-text="parent stays bright"]').first()
  const child = page.locator('li.li-node[data-body-text="child archived @archived"]').first()
  await expect(parent).toBeVisible({ timeout: 15000 })
  await expect(child).toBeVisible({ timeout: 15000 })

  await expect.poll(async () => await parent.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('0')
  await expect.poll(async () => await child.getAttribute('data-archived-self'), { timeout: 10000 }).toBe('1')

  const parentOpacity = await parent.locator('> .li-row').evaluate(el => Number.parseFloat(getComputedStyle(el).opacity))
  const childOpacity = await child.locator('> .li-row').evaluate(el => Number.parseFloat(getComputedStyle(el).opacity))

  expect(parentOpacity).toBeGreaterThanOrEqual(0.96)
  expect(childOpacity).toBeLessThan(0.9)
})

test('hiding archived children does not hide the parent', async ({ page, request, app }) => {
  await ensureBackendReady(request, app)
  await resetOutline(app)

  await page.goto('/')

  const editor = page.locator('.tiptap.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })

  const firstParagraph = page.locator('li.li-node p').first()
  await expect(firstParagraph).toBeVisible({ timeout: SHORT_TIMEOUT })
  await firstParagraph.click()
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

  const listItems = page.locator('li.li-node')
  await expect(listItems.nth(0)).toContainText('Parent stays bright', { timeout: SHORT_TIMEOUT })

  await page.keyboard.press('Enter')
  await expect(listItems).toHaveCount(2, { timeout: SHORT_TIMEOUT })

  await page.keyboard.press('Tab')
  await listItems.nth(1).locator('p').first().click()
  await page.keyboard.type('Child archived @archived')

  const parent = page.locator('li.li-node[data-body-text="Parent stays bright"]').first()
  const child = page.locator('li.li-node[data-body-text="Child archived @archived"]').first()
  await expect(parent).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect(child).toBeVisible({ timeout: SHORT_TIMEOUT })

  await expect.poll(async () => await child.getAttribute('data-archived-self'), { timeout: SHORT_TIMEOUT }).toBe('1')
  await expect.poll(async () => await parent.getAttribute('data-archived-self'), { timeout: SHORT_TIMEOUT }).toBe('0')

  const archivedToggle = page.locator('.archive-toggle .btn.pill')
  await expect(archivedToggle).toBeVisible({ timeout: SHORT_TIMEOUT })
  const label = (await archivedToggle.textContent())?.trim()
  if (label === 'Shown') {
    await archivedToggle.click()
  }
  await expect.poll(async () => (await archivedToggle.textContent())?.trim(), { timeout: SHORT_TIMEOUT })
    .toBe('Hidden')

  await expect(child).toBeHidden({ timeout: SHORT_TIMEOUT })
  await expect(parent, 'parent should remain visible when only child is archived').toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => await parent.getAttribute('data-archived'), { timeout: SHORT_TIMEOUT }).toBe('0')
})
