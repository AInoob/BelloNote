const { test, expect } = require('./test-base')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5231'

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

async function waitForOutlineReady(page) {
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: 10000, message: 'outline should finish loading' }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible()
}

test('tasks default to no status and cycle through states', async ({ page, request }) => {
  await resetOutline(request, [
    {
      id: null,
      title: 'Statusless task',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Statusless task' }] }],
      children: []
    }
  ])

  await page.goto('/')
  page.on('console', msg => console.log('browser:', msg.text()))
  await waitForOutlineReady(page)
  const task = page.locator('li.li-node').first()
  await expect(task).toBeVisible()
  await expect(task).toHaveAttribute('data-status', '')
  await expect(page.locator('.li-row.is-selected')).toHaveCount(0)

  const statusChip = task.locator('.status-chip.inline')
  await expect(statusChip).toHaveText('')

  await statusChip.click()
  await expect(task).toHaveAttribute('data-status', 'todo')
  await expect(statusChip).toHaveText('○')

  await statusChip.click()
  await expect(task).toHaveAttribute('data-status', 'in-progress')
  await expect(statusChip).toHaveText('◐')

  await statusChip.click()
  await expect(task).toHaveAttribute('data-status', 'done')
  await expect(statusChip).toHaveText('✓')

  await statusChip.click()
  await expect(task).toHaveAttribute('data-status', '')
  await expect(statusChip).toHaveText('')
})

test('question mark key does not trigger slash menu', async ({ page, request }) => {
  await resetOutline(request, [
    { id: null, title: 'Question task', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Question task' }] }], children: [] }
  ])

  await page.goto('/')
  await waitForOutlineReady(page)
  const task = page.locator('li.li-node').first()
  await expect(task).toBeVisible()

  const paragraph = task.locator('.li-content p').first()
  await paragraph.click()
  await page.keyboard.press('Shift+Slash')

  await expect(page.locator('.slash-menu')).toHaveCount(0)
  await expect(paragraph).toHaveText('Question task?')
})
