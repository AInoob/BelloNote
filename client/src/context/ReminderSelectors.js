import { useMemo } from 'react'
import { useReminders } from './ReminderContext.jsx'

export function usePendingReminderCount() {
  const { pendingReminders } = useReminders()
  return pendingReminders.length || 0
}

export function useReminderByTask(id) {
  const { remindersByTask } = useReminders()
  return useMemo(() => {
    if (!id) return null
    return remindersByTask.get(String(id)) || null
  }, [remindersByTask, id])
}
