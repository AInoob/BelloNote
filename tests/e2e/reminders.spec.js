const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5231'

function toDateTimeLocal(date) {
  const pad = (value) => `${value}`.padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function nowMinusMinutes(minutes) {
  const date = new Date(Date.now() - minutes * 60 * 1000)
  return toDateTimeLocal(date)
}

function nowPlusMinutes(minutes) {
  const date = new Date(Date.now() + minutes * 60 * 1000)
  return toDateTimeLocal(date)
}

async function resetOutline(request, outline) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  return body
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
  const firstReminderPill = page.locator('li.li-node').first().locator('.reminder-pill')
  await expect(firstReminderPill).toHaveText(/Reminds|Due/i)

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

  const reminderPill = page.locator('li.li-node').first().locator('.reminder-pill')
  await expect(reminderPill).toHaveText(/Due/i)

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Mark complete' }).click()
  await expect(banner).toHaveCount(0)

  const firstNode = page.locator('li.li-node').first()
  await expect(firstNode).toHaveAttribute('data-status', 'done')
  await expect(reminderPill).toHaveCount(0)
  await expect(reminderToggle).toHaveAttribute('aria-label', /Reminder completed/i)

  await page.getByRole('button', { name: 'Reminders' }).click()
  await expect(page.locator('.tiptap .li-node', { hasText: 'Follow up item' })).toHaveCount(1)
})

test('reminder banner supports custom schedule from notification', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Banner reminder', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Banner reminder' }] }] }
  ])

  await page.goto('/')
  const reminderToggle = page.locator('li.li-node').first().locator('.li-reminder-area .reminder-toggle')
  await reminderToggle.click()
  await page.locator('.reminder-menu').getByRole('button', { name: 'Custom…' }).click()
  const picker = page.locator('.reminder-menu input[type="datetime-local"]')
  await picker.fill(nowMinusMinutes(1))
  await page.locator('.reminder-menu form').getByRole('button', { name: 'Set reminder' }).click()

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible()

  const customButton = banner.getByRole('button', { name: 'Custom…' })
  await customButton.click()

  const bannerForm = banner.locator('.reminder-custom')
  await expect(bannerForm).toBeVisible()

  const bannerInput = bannerForm.locator('input[type="datetime-local"]')
  await bannerInput.fill(nowPlusMinutes(90))
  await bannerForm.getByRole('button', { name: 'Set' }).click()

  await expect(banner).toHaveCount(0)

  const reminderPill = page.locator('li.li-node').first().locator('.reminder-pill')
  await expect(reminderPill).toHaveText(/Reminds/i)
  await expect(reminderToggle).toHaveAttribute('aria-label', /Reminds/i)
})

test('reminder banner custom defaults to roughly 30 minutes ahead', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Default custom check', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Default custom check' }] }] }
  ])

  await page.goto('/')
  const reminderToggle = page.locator('li.li-node').first().locator('.li-reminder-area .reminder-toggle')
  await reminderToggle.click()
  await page.locator('.reminder-menu').getByRole('button', { name: 'Custom…' }).click()
  const picker = page.locator('.reminder-menu input[type="datetime-local"]')
  await picker.fill(nowMinusMinutes(1))
  await page.locator('.reminder-menu form').getByRole('button', { name: 'Set reminder' }).click()

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Custom…' }).click()
  const bannerInput = banner.locator('.reminder-custom input[type="datetime-local"]')
  await expect(bannerInput).toBeVisible()
  const value = await bannerInput.inputValue()

  expect(value).not.toEqual('')
  expect(value).not.toMatch(/^1970-/)

  const scheduledTime = new Date(value)
  const diffMinutes = (scheduledTime.getTime() - Date.now()) / (60 * 1000)
  expect(diffMinutes).toBeGreaterThan(26)
  expect(diffMinutes).toBeLessThan(34)
})

test('dismissing reminders preserves their status', async ({ request }) => {
  await resetOutline(request, [
    { title: 'Incomplete reminder task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Incomplete reminder task' }] }] },
    { title: 'Completed reminder task', status: 'done', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completed reminder task' }] }] }
  ])

  const outlineResponse = await request.get(`${API_URL}/api/outline`)
  expect(outlineResponse.ok()).toBeTruthy()
  const outlineData = await outlineResponse.json()
  const roots = outlineData?.roots || []
  const findTaskId = (title) => {
    const match = roots.find(node => node?.title === title)
    return match?.id
  }
  const incompleteTaskId = findTaskId('Incomplete reminder task')
  const completedTaskId = findTaskId('Completed reminder task')
  expect(incompleteTaskId).toBeTruthy()
  expect(completedTaskId).toBeTruthy()

  const remindSoon = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const remindPast = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  // Incomplete flow
  const createIncomplete = await request.post(`${API_URL}/api/reminders`, { data: { taskId: incompleteTaskId, remindAt: remindSoon } })
  expect(createIncomplete.ok()).toBeTruthy()
  const incompleteReminder = (await createIncomplete.json()).reminder
  expect(incompleteReminder.status).toBe('incomplete')

  const dismissIncomplete = await request.post(`${API_URL}/api/reminders/${incompleteReminder.id}/dismiss`)
  expect(dismissIncomplete.ok()).toBeTruthy()
  const dismissedIncomplete = (await dismissIncomplete.json()).reminder
  expect(dismissedIncomplete.status).toBe('incomplete')
  expect(dismissedIncomplete.dismissedAt).toBeTruthy()

  // Completed flow
  const createCompleted = await request.post(`${API_URL}/api/reminders`, { data: { taskId: completedTaskId, remindAt: remindPast } })
  expect(createCompleted.ok()).toBeTruthy()
  const createdCompleted = (await createCompleted.json()).reminder

  const completeResponse = await request.post(`${API_URL}/api/reminders/${createdCompleted.id}/complete`)
  expect(completeResponse.ok()).toBeTruthy()
  const completedReminder = (await completeResponse.json()).reminder
  expect(completedReminder.status).toBe('completed')
  expect(completedReminder.completedAt).toBeTruthy()

  const dismissCompleted = await request.post(`${API_URL}/api/reminders/${createdCompleted.id}/dismiss`)
  expect(dismissCompleted.ok()).toBeTruthy()
  const dismissedCompleted = (await dismissCompleted.json()).reminder
  expect(dismissedCompleted.status).toBe('completed')
  expect(dismissedCompleted.completedAt).toBeTruthy()
  expect(dismissedCompleted.dismissedAt).toBeTruthy()
})
