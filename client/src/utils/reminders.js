import dayjs from 'dayjs'

export const REMINDER_FILTERS = [
  { key: 'due', label: 'Due / Overdue' },
  { key: 'upcoming', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' }
]

export const REMINDER_STATUS_ORDER = REMINDER_FILTERS.map((filter) => filter.key)

export function isReminderDue(reminder) {
  if (!reminder) return false
  if (reminder.due) return true
  if (!reminder.remindAt) return false
  const parsed = dayjs(reminder.remindAt)
  if (!parsed.isValid()) return false
  return parsed.isBefore(dayjs())
}

export function reminderStatusKey(reminder) {
  if (!reminder) return 'upcoming'
  if (reminder.status === 'completed') return 'completed'
  return isReminderDue(reminder) ? 'due' : 'upcoming'
}

export function formatReminderAbsolute(reminder) {
  if (!reminder?.remindAt) return ''
  const parsed = dayjs(reminder.remindAt)
  if (!parsed.isValid()) return ''
  return parsed.format('MMM D, YYYY h:mm A')
}
