import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { getOutline } from '../api.js'
import { parseReminderFromNodeContent, reminderIsDue, describeTimeUntil } from '../utils/reminderTokens.js'
import { REMINDER_POLL_INTERVAL_MS } from '../constants/config.js'

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

function extractRemindersFromOutline(roots = []) {
  const reminders = []
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
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  (roots || []).forEach(visit)
  return reminders
}

export function ReminderProvider({ children }) {
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const lastSnapshotRef = useRef('')

  const updateFromOutline = useCallback((roots) => {
    const next = extractRemindersFromOutline(roots)
    const key = JSON.stringify((next || []).map(item => `${item.taskId}|${item.status}|${item.remindAt}`))
    if (lastSnapshotRef.current === key) return
    lastSnapshotRef.current = key
    if (typeof console !== 'undefined') {
      console.log('[reminders] outline snapshot detected', { count: next.length, due: next.filter(item => reminderIsDue(item)).length })
    }
    setReminders(next)
    if (typeof window !== 'undefined') {
      window.__WORKLOG_REMINDERS = next
      window.__WORKLOG_REMINDER_OUTLINE = roots
    }
  }, [])

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

  useEffect(() => { refreshReminders() }, [refreshReminders])

  useEffect(() => {
    const interval = setInterval(() => {
      setReminders(prev => prev.map(reminder => {
        const due = reminderIsDue(reminder)
        if (due === reminder.due) return reminder
        return { ...reminder, due }
      }))
    }, REMINDER_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handler = (event) => {
      const roots = event?.detail?.outline
      if (Array.isArray(roots)) updateFromOutline(roots)
    }
    window.addEventListener('worklog:outline-snapshot', handler)
    return () => window.removeEventListener('worklog:outline-snapshot', handler)
  }, [updateFromOutline])

  const remindersByTask = useMemo(() => {
    const map = new Map()
    reminders.forEach(reminder => {
      if (reminder?.taskId) map.set(String(reminder.taskId), reminder)
    })
    return map
  }, [reminders])

  const pendingReminders = useMemo(() => reminders.filter(reminderIsDue), [reminders])

  const dispatch = useCallback((action, payload) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('worklog:reminder-action', { detail: { action, ...payload } }))
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

export function useReminders() {
  return useContext(ReminderContext)
}

export function useReminderForTask(taskId) {
  const { remindersByTask } = useReminders()
  if (!taskId) return null
  return remindersByTask.get(String(taskId)) || null
}
