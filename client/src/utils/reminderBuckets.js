import { reminderStatusKey } from './reminders.js'

const SORTERS = {
  due: (a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0),
  upcoming: (a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0),
  completed: (a, b) => new Date(b.remindAt || 0) - new Date(a.remindAt || 0)
}

export function bucketRemindersByStatus(reminders) {
  const buckets = {
    due: [],
    upcoming: [],
    completed: []
  }

  reminders.forEach((reminder) => {
    const key = reminderStatusKey(reminder)
    buckets[key].push(reminder)
  })

  return {
    due: buckets.due.sort(SORTERS.due),
    upcoming: buckets.upcoming.sort(SORTERS.upcoming),
    completed: buckets.completed.sort(SORTERS.completed)
  }
}
