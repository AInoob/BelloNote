const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

let API_URL = null
const SHORT_TIMEOUT = 1000
const REMINDER_PILL_PATTERN = /Remind|Due|in\s|overdue|Dismissed|Completed/i

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
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  return body
}

test.beforeEach(async ({ app }) => {
  API_URL = app.apiUrl;
})

test('schedule reminder from outline and remove it', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Task A', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task A' }] }] },
    { title: 'Task B', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task B' }] }] }
  ])

  await page.goto('/')
  const firstReminderToggle = page.locator('li.li-node').first().locator('.li-reminder-area .reminder-toggle')
  await expect(firstReminderToggle).toBeVisible({ timeout: SHORT_TIMEOUT })
  await firstReminderToggle.click()

  const saveResponsePromise = page.waitForResponse((response) => {
    return response.url().includes('/api/outline') && response.request().method() === 'POST'
  })
  await page.locator('.reminder-menu').locator('button', { hasText: '30 minutes' }).click()
  const firstReminderChip = page.locator('li.li-node').first().locator('.reminder-inline-chip')
  await expect(firstReminderChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })
  await saveResponsePromise

  await expect.poll(async () => {
    return page.evaluate(() => {
      const reminders = Array.isArray(window.__WORKLOG_REMINDERS) ? window.__WORKLOG_REMINDERS : []
      return reminders.some(item => item?.taskTitle === 'Task A')
    })
  }, { timeout: SHORT_TIMEOUT * 5 }).toBe(true)

  await page.getByRole('button', { name: 'Reminders' }).click()
  const remindersPanel = page.locator('.reminders-view')
  await expect(remindersPanel).toBeVisible({ timeout: SHORT_TIMEOUT * 5 })
  const remindersOutline = remindersPanel.locator('.reminder-outline .tiptap.ProseMirror')
  await expect(remindersOutline).toBeVisible({ timeout: SHORT_TIMEOUT * 5 })
  await expect.poll(async () => remindersOutline.locator('li.li-node').count(), {
    timeout: SHORT_TIMEOUT * 5
  }).toBeGreaterThan(0)
  const reminderNode = remindersOutline.locator('li.li-node').first()
  await expect(reminderNode).toContainText('Task A', { timeout: SHORT_TIMEOUT * 5 })
  await reminderNode.hover()
  const reminderToggle = reminderNode.locator('.reminder-toggle').first()
  await expect(reminderToggle).toBeVisible({ timeout: SHORT_TIMEOUT })
  await reminderToggle.click()
  const reminderMenu = page.locator('.reminder-menu')
  await expect(reminderMenu).toBeVisible({ timeout: SHORT_TIMEOUT * 5 })
  await reminderMenu.getByRole('button', { name: /Remove reminder/i }).click()
  await expect(remindersOutline.locator('li.li-node', { hasText: 'Task A' })).toHaveCount(0, { timeout: SHORT_TIMEOUT * 5 })
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

  const reminderChip = page.locator('li.li-node').first().locator('.reminder-inline-chip')
  await expect(reminderChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible({ timeout: SHORT_TIMEOUT })
  await banner.getByRole('button', { name: 'Mark complete' }).click()
  await expect(banner).toHaveCount(0)

  const firstNode = page.locator('li.li-node').first()
  await expect(firstNode).toHaveAttribute('data-status', 'done', { timeout: SHORT_TIMEOUT })
  await expect(reminderChip).toHaveText(/Completed/i, { timeout: SHORT_TIMEOUT })
  await expect(reminderToggle).toHaveAttribute('aria-label', /Reminder completed/i, { timeout: SHORT_TIMEOUT })

  await page.getByRole('button', { name: 'Reminders' }).click()
  await expect(page.locator('.reminders-view .tiptap.ProseMirror li.li-node', { hasText: 'Follow up item' })).toHaveCount(1, { timeout: SHORT_TIMEOUT })
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
  const pastTarget = nowMinusMinutes(1)
  await picker.fill(pastTarget)
  await page.locator('.reminder-menu form').getByRole('button', { name: 'Set reminder' }).click()

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible({ timeout: SHORT_TIMEOUT })

  const customButton = banner.getByRole('button', { name: 'Custom…' })
  await customButton.click()

  const bannerForm = banner.locator('.reminder-custom')
  await expect(bannerForm).toBeVisible({ timeout: SHORT_TIMEOUT })

  const bannerInput = bannerForm.locator('input[type="datetime-local"]')
  await bannerInput.fill(nowPlusMinutes(90))
  await bannerForm.getByRole('button', { name: 'Set' }).click()

  await expect(banner).toHaveCount(0)

  const reminderChip = page.locator('li.li-node').first().locator('.reminder-inline-chip')
  await expect(reminderChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })
  await expect(reminderToggle).toHaveAttribute('aria-label', /Reminder (due|options|completed|dismissed|Reminds)/i, { timeout: SHORT_TIMEOUT })
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
  const pastTarget = nowMinusMinutes(1)
  await picker.fill(pastTarget)
  await page.locator('.reminder-menu form').getByRole('button', { name: 'Set reminder' }).click()

  const banner = page.locator('.reminder-banner')
  await expect(banner).toBeVisible({ timeout: SHORT_TIMEOUT })

  await banner.getByRole('button', { name: 'Custom…' }).click()
  const bannerInput = banner.locator('.reminder-custom input[type="datetime-local"]')
  await expect(bannerInput).toBeVisible({ timeout: SHORT_TIMEOUT })
  const value = await bannerInput.inputValue()

  expect(value).not.toEqual('')
  expect(value).not.toMatch(/^1970-/)

  const scheduledTime = new Date(value)
  const originalTime = new Date(pastTarget)
  const diffMinutes = Math.abs((scheduledTime.getTime() - originalTime.getTime()) / (60 * 1000))
  expect(diffMinutes).toBeLessThan(2)
})

test('tasks seeded with inline reminder token render correctly', async ({ page, request }) => {
  const remindAt = nowPlusMinutes(45)
  const message = 'Follow up soon'
  const token = `[[reminder|incomplete|${remindAt}|${encodeURIComponent(message)}]]`
  await resetOutline(request, [
    {
      title: 'Seeded Task',
      status: 'todo',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Seeded Task ${token}` }] }
      ],
      children: []
    }
  ])

  await page.goto('/')
  const firstNode = page.locator('li.li-node').first()
  await expect(firstNode).toContainText('Seeded Task', { timeout: SHORT_TIMEOUT })
  await expect.poll(async () => {
    const visibleText = await firstNode.evaluate(node => node?.innerText || '')
    return visibleText
  }, { timeout: SHORT_TIMEOUT }).not.toContain('[[reminder')
  const inlineChip = firstNode.locator('.reminder-inline-chip').first()
  await expect(inlineChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })
  await inlineChip.click()
  const inlineMenu = page.locator('.reminder-menu')
  await expect(inlineMenu).toBeVisible({ timeout: SHORT_TIMEOUT })
  await page.locator('.tiptap.ProseMirror').first().click()
  await expect(inlineChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })
  await expect(firstNode.locator('.li-reminder-area .reminder-toggle')).toHaveAttribute('aria-label', /Reminder (due|options|completed|dismissed|Reminds)/i, { timeout: SHORT_TIMEOUT })

  await expect.poll(async () => {
    const count = await page.evaluate(() => {
      const reminders = Array.isArray(window.__WORKLOG_REMINDERS) ? window.__WORKLOG_REMINDERS : []
      return reminders.length
    })
    return count
  }, { timeout: SHORT_TIMEOUT * 5 }).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Reminders' }).click()
  const remindersPanel = page.locator('.reminders-view')
  await expect(remindersPanel).toBeVisible({ timeout: SHORT_TIMEOUT * 5 })
  await expect(remindersPanel).toContainText('Seeded Task', { timeout: SHORT_TIMEOUT })
  await expect(remindersPanel).toContainText(/Reminder (due|completed|dismissed)|in\s|overdue/i, { timeout: SHORT_TIMEOUT })
})

test('dismissing reminders preserves task status', async ({ page, request }) => {
  await resetOutline(request, [
    { title: 'Incomplete reminder task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Incomplete reminder task' }] }] },
    { title: 'Completed reminder task', status: 'done', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completed reminder task' }] }] }
  ])

  await page.goto('/')
  const items = page.locator('li.li-node')
  const first = items.nth(0)
  const second = items.nth(1)

  await expect(first).toHaveAttribute('data-status', 'todo', { timeout: SHORT_TIMEOUT })
  await expect(second).toHaveAttribute('data-status', 'done', { timeout: SHORT_TIMEOUT })

  const scheduleThirtyMinutes = async (node) => {
    const toggle = node.locator('.li-reminder-area .reminder-toggle')
    await toggle.click()
    const menu = page.locator('.reminder-menu')
    await expect(menu).toBeVisible({ timeout: SHORT_TIMEOUT })
    await menu.locator('button', { hasText: '30 minutes' }).click()
    await expect(node.locator('.reminder-inline-chip')).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })
  }

  const dismissReminder = async (node) => {
    const toggle = node.locator('.li-reminder-area .reminder-toggle')
    await toggle.click()
    const menu = page.locator('.reminder-menu')
    await expect(menu).toBeVisible({ timeout: SHORT_TIMEOUT })
    await menu.getByRole('button', { name: 'Dismiss' }).click()
    await expect(node.locator('.reminder-inline-chip')).toHaveText(/Dismissed/i, { timeout: SHORT_TIMEOUT })
    await expect(toggle).toHaveAttribute('aria-label', /Reminder dismissed/i, { timeout: SHORT_TIMEOUT })
  }

  await scheduleThirtyMinutes(first)
  await scheduleThirtyMinutes(second)

  await dismissReminder(first)
  await dismissReminder(second)

  await expect(first).toHaveAttribute('data-status', 'todo', { timeout: SHORT_TIMEOUT })
  await expect(second).toHaveAttribute('data-status', 'done', { timeout: SHORT_TIMEOUT })
})

test('copying and pasting a reminder task preserves the reminder token', async ({ page, request }) => {
  const remindAt = nowPlusMinutes(20)
  const token = `[[reminder|incomplete|${remindAt}|]]`
  await resetOutline(request, [
    {
      title: 'Reminder source',
      status: 'todo',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `Reminder source ${token}` }] }
      ]
    }
  ])

  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror').first()
  await editor.click()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  await page.keyboard.press(`${modifier}+a`)
  await page.keyboard.press(`${modifier}+c`)
  await page.keyboard.press('Backspace')
  await page.keyboard.press(`${modifier}+v`)

  const saveIndicator = page.locator('.save-indicator').first()
  await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT * 5 })

  const reminderChip = page.locator('li.li-node').first().locator('.reminder-inline-chip')
  await expect(reminderChip).toHaveText(REMINDER_PILL_PATTERN, { timeout: SHORT_TIMEOUT })

  await expect.poll(async () => {
    const reminders = await page.evaluate(() => window.__WORKLOG_REMINDERS || [])
    return reminders.length
  }, { timeout: SHORT_TIMEOUT * 5 }).toBeGreaterThan(0)

  const reminderState = await page.evaluate(() => (window.__WORKLOG_REMINDERS || [])[0] || null)
  expect(reminderState?.token || '').toContain('[[reminder|incomplete|')
})
