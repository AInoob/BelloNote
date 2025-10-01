import dayjs from 'dayjs'

// ============================================================================
// Constants
// ============================================================================

export const REMINDER_FILTERS = [
  { key: 'due', label: 'Due / Overdue' },
  { key: 'upcoming', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' }
]

export const REMINDER_STATUS_ORDER = REMINDER_FILTERS.map((filter) => filter.key)

// ============================================================================
// Reminder Status Functions
// ============================================================================

/**
 * Checks if a reminder is due (past its remind time)
 * @param {Object} reminder - The reminder object to check
 * @param {string} [reminder.remindAt] - The ISO date string when reminder is due
 * @param {boolean} [reminder.due] - Pre-computed due flag
 * @returns {boolean} True if the reminder is due or overdue
 */
export function isReminderDue(reminder) {
  if (!reminder) return false
  if (reminder.due) return true
  if (!reminder.remindAt) return false

  const parsed = dayjs(reminder.remindAt)
  if (!parsed.isValid()) return false

  return parsed.isBefore(dayjs())
}

/**
 * Determines the status category of a reminder
 * @param {Object} reminder - The reminder object
 * @param {string} [reminder.status] - The reminder status
 * @returns {string} Status key: 'completed', 'due', or 'upcoming'
 */
export function reminderStatusKey(reminder) {
  if (!reminder) return 'upcoming'
  if (reminder.status === 'completed') return 'completed'
  return isReminderDue(reminder) ? 'due' : 'upcoming'
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats a reminder's datetime in absolute format
 * @param {Object} reminder - The reminder object
 * @param {string} [reminder.remindAt] - ISO date string
 * @returns {string} Formatted date string (e.g., "Jan 15, 2024 3:30 PM") or empty string
 */
export function formatReminderAbsolute(reminder) {
  if (!reminder?.remindAt) return ''

  const parsed = dayjs(reminder.remindAt)
  if (!parsed.isValid()) return ''

  return parsed.format('MMM D, YYYY h:mm A')
}
