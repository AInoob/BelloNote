import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getOutline } from '../api.js'
import { parseReminderFromNodeContent, reminderIsDue } from '../utils/reminderTokens.js'

const SNAPSHOT_EVENT = 'worklog:outline-snapshot'
const REMINDER_ACTION_EVENT = 'worklog:reminder-action'
const DUE_REFRESH_INTERVAL_MS = 30_000

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

    if (Array.isArray(node.children)) {
      node.children.forEach(visit)
    }
  }

  ;(roots || []).forEach(visit)
  return reminders
}

function snapshotKey(reminders) {
  return JSON.stringify(reminders.map((item) => `${item.taskId}|${item.status}|${item.remindAt}`))
}

function exposeToWindow(reminders, roots) {
  if (typeof window === 'undefined') return
  window.__WORKLOG_REMINDERS = reminders
  window.__WORKLOG_REMINDER_OUTLINE = roots
}

function useDueRefresh(setReminders) {
  useEffect(() => {
    const interval = setInterval(() => {
      setReminders((previous) => previous.map((reminder) => {
        const due = reminderIsDue(reminder)
        if (due === reminder.due) return reminder
        return { ...reminder, due }
      }))
    }, DUE_REFRESH_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [setReminders])
}

function useSnapshotListener(updateFromOutline) {
  useEffect(() => {
    const handler = (event) => {
      if (!Array.isArray(event?.detail?.outline)) return
      updateFromOutline(event.detail.outline)
    }

    window.addEventListener(SNAPSHOT_EVENT, handler)
    return () => window.removeEventListener(SNAPSHOT_EVENT, handler)
  }, [updateFromOutline])
}

function useReminderActions() {
  const dispatch = useCallback((action, payload) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(REMINDER_ACTION_EVENT, { detail: { action, ...payload } }))
  }, [])

  const taskOnlyAction = useCallback((action) => (taskId) => {
    if (!taskId) return Promise.resolve()
    dispatch(action, { taskId: String(taskId) })
    return Promise.resolve()
  }, [dispatch])

  const scheduleReminder = useCallback(({ taskId, remindAt, message }) => {
    if (!taskId || !remindAt) return Promise.resolve()
    dispatch('schedule', { taskId: String(taskId), remindAt, message })
    return Promise.resolve()
  }, [dispatch])

  return {
    scheduleReminder,
    dismissReminder: taskOnlyAction('dismiss'),
    completeReminder: taskOnlyAction('complete'),
    removeReminder: taskOnlyAction('remove')
  }
}

export function ReminderProvider({ children }) {
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const lastSnapshotRef = useRef('')

  const updateFromOutline = useCallback((roots) => {
    const nextReminders = extractRemindersFromOutline(roots)
    const nextKey = snapshotKey(nextReminders)
    if (lastSnapshotRef.current === nextKey) return
    lastSnapshotRef.current = nextKey

    if (typeof console !== 'undefined') {
      console.log('[reminders] outline snapshot detected', {
        count: nextReminders.length,
        due: nextReminders.filter(reminderIsDue).length
      })
    }

    setReminders(nextReminders)
    exposeToWindow(nextReminders, roots)
  }, [])

  const refreshReminders = useCallback(async () => {
    try {
      const data = await getOutline()
      updateFromOutline(Array.isArray(data?.roots) ? data.roots : [])
    } catch (error) {
      console.error('[reminders] failed to load outline', error)
    } finally {
      setLoading(false)
    }
  }, [updateFromOutline])

  useEffect(() => {
    refreshReminders()
  }, [refreshReminders])

  useDueRefresh(setReminders)
  useSnapshotListener(updateFromOutline)

  const { scheduleReminder, dismissReminder, completeReminder, removeReminder } = useReminderActions()

  const remindersByTask = useMemo(() => {
    const map = new Map()
    reminders.forEach((reminder) => {
      if (reminder?.taskId) {
        map.set(String(reminder.taskId), reminder)
      }
    })
    return map
  }, [reminders])

  const pendingReminders = useMemo(() => reminders.filter(reminderIsDue), [reminders])

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
