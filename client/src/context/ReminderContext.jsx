import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { getOutline } from '../api.js'
import { parseReminderFromNodeContent, reminderIsDue, describeTimeUntil } from '../utils/reminderTokens.js'

// ============================================================================
// Context Definition
// ============================================================================

const ReminderContext = createContext({
  loading: false,
  reminders: [],
  remindersByTask: new Map(),
  pendingReminders: [],
  refreshReminders: () => {},
  scheduleReminder: () => {},
  dismissReminder: () => {},
  completeReminder: () => {},
  removeReminder: () => {}
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts all reminders from an outline tree structure
 * Recursively walks through the outline and collects reminder information
 * @param {Array} [roots=[]] - Root nodes of the outline
 * @returns {Array} Array of reminder objects with task information
 */
function extractRemindersFromOutline(roots = []) {
  const reminders = []

  /**
   * Visits a node and extracts reminder if present
   * @param {Object} node - Outline node to process
   */
  const visit = (node) => {
    if (!node || typeof node !== 'object') return

    const reminder = parseReminderFromNodeContent(node?.content)
    if (reminder && node.id != null) {
      reminders.push({
        id: String(node.id),
        taskId: String(node.id),
        taskTitle: node.title || '',
        taskStatus: node.status || '',
        status: reminder.status || 'incomplete',
        remindAt: reminder.remindAt || '',
        message: reminder.message || '',
        token: reminder.token || '',
        due: reminderIsDue(reminder)
      })
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(visit)
    }
  }

  (roots || []).forEach(visit)
  return reminders
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provider component that manages reminder state and operations
 * Syncs reminders with the outline and provides reminder-related functionality
 */
export function ReminderProvider({ children }) {
  // State
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const lastSnapshotRef = useRef('')

  /**
   * Updates reminders from outline data
   * Only updates if the snapshot has changed to prevent unnecessary re-renders
   */
  const updateFromOutline = useCallback((roots) => {
    const next = extractRemindersFromOutline(roots)
    const key = JSON.stringify((next || []).map(item => `${item.taskId}|${item.status}|${item.remindAt}`))

    // Skip update if nothing changed
    if (lastSnapshotRef.current === key) return

    lastSnapshotRef.current = key

    if (typeof console !== 'undefined') {
      console.log('[reminders] outline snapshot detected', {
        count: next.length,
        due: next.filter(item => reminderIsDue(item)).length
      })
    }

    setReminders(next)

    // Expose to window for debugging
    if (typeof window !== 'undefined') {
      window.__WORKLOG_REMINDERS = next
      window.__WORKLOG_REMINDER_OUTLINE = roots
    }
  }, [])

  /**
   * Fetches outline from API and updates reminders
   */
  const refreshReminders = useCallback(async () => {
    try {
      const data = await getOutline()
      updateFromOutline(Array.isArray(data?.roots) ? data.roots : [])
    } catch (err) {
      console.error('[reminders] failed to load outline', err)
    } finally {
      setLoading(false)
    }
  }, [updateFromOutline])

  // Initial load
  useEffect(() => {
    refreshReminders()
  }, [refreshReminders])

  // Periodic check to update "due" status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setReminders(prev => prev.map(reminder => {
        const due = reminderIsDue(reminder)
        if (due === reminder.due) return reminder
        return { ...reminder, due }
      }))
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Listen for outline snapshot events
  useEffect(() => {
    const handler = (event) => {
      const roots = event?.detail?.outline
      if (Array.isArray(roots)) {
        updateFromOutline(roots)
      }
    }
    window.addEventListener('worklog:outline-snapshot', handler)
    return () => window.removeEventListener('worklog:outline-snapshot', handler)
  }, [updateFromOutline])

  // Computed values
  const remindersByTask = useMemo(() => {
    const map = new Map()
    reminders.forEach(reminder => {
      if (reminder?.taskId) {
        map.set(String(reminder.taskId), reminder)
      }
    })
    return map
  }, [reminders])

  const pendingReminders = useMemo(() => {
    return reminders.filter(reminderIsDue)
  }, [reminders])

  // Action dispatchers
  /**
   * Dispatches a reminder action event
   */
  const dispatch = useCallback((action, payload) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
      detail: { action, ...payload }
    }))
  }, [])

  const scheduleReminder = useCallback(({ taskId, remindAt, message }) => {
    if (!taskId || !remindAt) return Promise.resolve()
    dispatch('schedule', { taskId: String(taskId), remindAt, message })
    return Promise.resolve()
  }, [dispatch])

  const dismissReminder = useCallback((taskId) => {
    if (!taskId) return Promise.resolve()
    dispatch('dismiss', { taskId: String(taskId) })
    return Promise.resolve()
  }, [dispatch])

  const completeReminder = useCallback((taskId) => {
    if (!taskId) return Promise.resolve()
    dispatch('complete', { taskId: String(taskId) })
    return Promise.resolve()
  }, [dispatch])

  const removeReminder = useCallback((taskId) => {
    if (!taskId) return Promise.resolve()
    dispatch('remove', { taskId: String(taskId) })
    return Promise.resolve()
  }, [dispatch])

  const value = useMemo(() => ({
    loading,
    reminders,
    remindersByTask,
    pendingReminders,
    refreshReminders,
    scheduleReminder,
    dismissReminder,
    completeReminder,
    removeReminder
  }), [loading, reminders, remindersByTask, pendingReminders, refreshReminders, scheduleReminder, dismissReminder, completeReminder, removeReminder])

  return (
    <ReminderContext.Provider value={value}>
      {children}
    </ReminderContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access the reminder context
 * @returns {Object} Reminder context value
 */
export function useReminders() {
  return useContext(ReminderContext)
}

/**
 * Hook to get the reminder for a specific task
 * @param {string} taskId - The task ID to look up
 * @returns {Object|null} The reminder object or null if not found
 */
export function useReminderForTask(taskId) {
  const { remindersByTask } = useReminders()
  if (!taskId) return null
  return remindersByTask.get(String(taskId)) || null
}
