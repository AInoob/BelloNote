// ============================================================================
// Reminder Buckets
// Groups reminders into status categories (due, upcoming, completed)
// ============================================================================

import { reminderStatusKey } from './reminders.js'

/** Sort functions for each bucket */
const SORTERS = {
  due: (a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0),
  upcoming: (a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0),
  completed: (a, b) => new Date(b.remindAt || 0) - new Date(a.remindAt || 0)
}

/**
 * Groups reminders by status and sorts them
 * @param {Array} reminders - Array of reminder objects
 * @returns {Object} Object with due, upcoming, and completed arrays
 */
export function bucketRemindersByStatus(reminders) {
  const buckets = {
    due: [],
    upcoming: [],
    completed: []
  }

  // Distribute reminders into buckets
  reminders.forEach((reminder) => {
    const key = reminderStatusKey(reminder)
    buckets[key].push(reminder)
  })

  // Sort and return
  return {
    due: buckets.due.sort(SORTERS.due),
    upcoming: buckets.upcoming.sort(SORTERS.upcoming),
    completed: buckets.completed.sort(SORTERS.completed)
  }
}
