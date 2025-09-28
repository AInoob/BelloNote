const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

let ORIGIN = null

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
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline: []  }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok(), 'outline reset should succeed').toBeTruthy()
}

function seedOutlineSimple() {
  return [
    { id: null, title: 'task A', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'task A' }] }], children: [] }
  ]
}

test.beforeEach(async ({ app }) => {
  ORIGIN = app.apiUrl;
})

test('history restore confirmation is visible above snapshot overlay (z-index)', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request)

  // Seed and create a checkpoint via UI so History has at least one row
  const outline = seedOutlineSimple()
  const setRes = await request.post(`${ORIGIN}/api/outline`, { data: { outline  }, headers: { 'x-playwright-test': '1' } })
  expect(setRes.ok()).toBeTruthy()

  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect(editor).toBeVisible()

  // Open Checkpoint dialog and save
  await page.getByRole('button', { name: 'Checkpoint' }).click()
  await page.getByRole('button', { name: 'Save checkpoint' }).click()
  // Wait for success and open history
  await expect(page.getByRole('button', { name: 'Open history' })).toBeVisible()
  await page.getByRole('button', { name: 'Open history' }).click()

  // History modal opens; select the latest item to enable right panel Restore
  const firstItem = page.locator('.history-day-list .history-item').first()
  await expect(firstItem).toBeVisible()
  await firstItem.click()

  // Click right panel Restore to open confirmation overlay
  const rightRestore = page.locator('.right .btn', { hasText: 'Restore' }).first()
  await expect(rightRestore).toBeVisible()
  await rightRestore.click()

  // Confirmation overlay should be visible and actionable (no z-index obstruction)
  const confirmTitle = page.getByRole('heading', { name: 'Confirm restore' })
  await expect(confirmTitle).toBeVisible()
  const confirmRestoreBtn = page.locator('.overlay .modal .btn', { hasText: 'Restore' }).last()
  await expect(confirmRestoreBtn).toBeVisible()

  // Cancel to avoid changing current outline
  await page.locator('.overlay .modal .btn', { hasText: 'Cancel' }).click()
  await expect(confirmTitle).toHaveCount(0)
})
