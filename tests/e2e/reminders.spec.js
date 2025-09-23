const { test, expect } = require('@playwright/test')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5231'

function nowMinusMinutes(minutes) {
  const date = new Date(Date.now() - minutes * 60 * 1000)
  return toDateTimeLocal(date)
}

function toDateTimeLocal(date) {
  const pad = (value) => `${value}`.padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

test('schedule reminder from outline and remove it', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Task A', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task A' }] }] },
    { title: 'Task B', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task B' }] }] }
  ])

  await page.goto('/')
  const firstReminderToggle = page.locator('li.li-node').first().locator('.li-reminder-area .reminder-toggle')
  await expect(firstReminderToggle).toBeVisible()
  await firstReminderToggle.click()

  await page.locator('.reminder-menu').locator('button', { hasText: '30 minutes' }).click()
  await expect(firstReminderToggle).toHaveText(/Reminds/i)

  await page.getByRole('button', { name: 'Reminders' }).click()
  await page.locator('.reminder-toggle').first().waitFor({ state: 'visible' })
  const reminderNode = page.locator('.tiptap .li-node', { hasText: 'Task A' })
  const reminderToggle = reminderNode.locator('.reminder-toggle').first()
  await reminderToggle.click()
  await page.locator('.reminder-menu').getByRole('button', { name: /Remove reminder/i }).click()
  await expect(page.locator('.tiptap .li-node', { hasText: 'Task A' })).toHaveCount(0)
})

test('due reminder surfaces notification and completes task', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Follow up item', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Follow up item' }] }] }
  ])

  await page.goto('/')
  const reminderToggle = page.locator('li.li-node').first().locator('.li-reminder-area .reminder-toggle')
  await reminderToggle.click()
  const customButton = page.locator('.reminder-menu').getByRole('button', { name: 'Custom…' })
  await customButton.click()
  const input = page.locator('.reminder-menu input[type="datetime-local"]')
  await input.fill(nowMinusMinutes(1))
  await page.locator('.reminder-menu form').getByRole('button', { name: 'Set reminder' }).click()

  await expect(reminderToggle).toHaveText(/Reminder due|due/i)

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Mark complete' }).click()
  await expect(banner).toHaveCount(0)

  const firstNode = page.locator('li.li-node').first()
  await expect(firstNode).toHaveAttribute('data-status', 'done')
  await expect(reminderToggle).toHaveText(/Reminder completed/i)

  await page.getByRole('button', { name: 'Reminders' }).click()
  await expect(page.locator('.tiptap .li-node', { hasText: 'Follow up item' })).toHaveCount(1)
})
