import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { completeReminder as apiCompleteReminder, createReminder as apiCreateReminder, deleteReminder as apiDeleteReminder, dismissReminder as apiDismissReminder, getReminders } from '../api.js'

const ReminderContext = createContext(null)

const mapFromList = (list = []) => {
  const byId = new Map()
  list.forEach(item => {
    if (item?.id) byId.set(item.id, item)
  })
  return byId
}

function applyReminderToMaps(prevMap, reminder) {
  const next = new Map(prevMap)
  if (!reminder || !reminder.id) return next
  // Remove any reminder with the same taskId under a different id
  Array.from(next.entries()).forEach(([key, value]) => {
    if (value.taskId === reminder.taskId && value.id !== reminder.id) {
      next.delete(key)
    }
  })
  next.set(reminder.id, reminder)
  return next
}

export function ReminderProvider({ children }) {
  const [remindersById, setRemindersById] = useState(() => new Map())
  const [pendingReminders, setPendingReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef(null)

  const reminders = useMemo(() => {
    return Array.from(remindersById.values()).sort((a, b) => {
      const aTime = a?.remindAt ? new Date(a.remindAt).getTime() : 0
      const bTime = b?.remindAt ? new Date(b.remindAt).getTime() : 0
      return aTime - bTime
    })
  }, [remindersById])

  const remindersByTask = useMemo(() => {
    const map = new Map()
    reminders.forEach(item => {
      if (item?.taskId) map.set(String(item.taskId), item)
    })
    return map
  }, [reminders])

  const fetchAll = useCallback(async () => {
    try {
      const data = await getReminders()
      setRemindersById(mapFromList(data?.reminders || []))
    } catch (err) {
      console.error('[reminders] failed to load', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPending = useCallback(async () => {
    try {
      const data = await getReminders({ pending: 1 })
      setPendingReminders(data?.reminders || [])
    } catch (err) {
      console.error('[reminders] failed to load pending', err)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    fetchPending()
    pollRef.current = setInterval(fetchPending, 20000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchAll, fetchPending])

  const dispatchReminderEvent = useCallback((reminder) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('worklog:reminder-updated', { detail: { reminder } }))
  }, [])

  const dispatchReminderDeleted = useCallback((reminder) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('worklog:reminder-removed', { detail: { reminder } }))
  }, [])

  const dispatchTaskStatusChange = useCallback((taskId, status) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('worklog:task-status-change', { detail: { taskId: String(taskId), status } }))
  }, [])

  const scheduleReminder = useCallback(async ({ taskId, remindAt, message }) => {
    const { reminder } = await apiCreateReminder({ taskId, remindAt, message })
    setRemindersById(prev => applyReminderToMaps(prev, reminder))
    dispatchReminderEvent(reminder)
    fetchPending()
    return reminder
  }, [dispatchReminderEvent, fetchPending])

  const dismissReminder = useCallback(async (reminderId) => {
    const { reminder } = await apiDismissReminder(reminderId)
    setRemindersById(prev => applyReminderToMaps(prev, reminder))
    dispatchReminderEvent(reminder)
    fetchPending()
    return reminder
  }, [dispatchReminderEvent, fetchPending])

  const completeReminder = useCallback(async (reminderId) => {
    const { reminder } = await apiCompleteReminder(reminderId)
    setRemindersById(prev => applyReminderToMaps(prev, reminder))
    dispatchReminderEvent(reminder)
    if (reminder?.taskId) dispatchTaskStatusChange(reminder.taskId, 'done')
    fetchPending()
    return reminder
  }, [dispatchReminderEvent, dispatchTaskStatusChange, fetchPending])

  const removeReminder = useCallback(async (reminderId) => {
    const existing = remindersById.get(reminderId)
    await apiDeleteReminder(reminderId)
    setRemindersById(prev => {
      const next = new Map(prev)
      next.delete(reminderId)
      return next
    })
    if (existing) dispatchReminderDeleted(existing)
    fetchPending()
  }, [dispatchReminderDeleted, fetchPending, remindersById])

  const value = useMemo(() => ({
    loading,
    reminders,
    remindersByTask,
    pendingReminders,
    refreshReminders: fetchAll,
    refreshPending: fetchPending,
    scheduleReminder,
    dismissReminder,
    completeReminder,
    removeReminder
  }), [completeReminder, dismissReminder, fetchAll, fetchPending, loading, pendingReminders, reminders, remindersByTask, scheduleReminder, removeReminder])

  return (
    <ReminderContext.Provider value={value}>
      {children}
    </ReminderContext.Provider>
  )
}

export function useReminders() {
  const ctx = useContext(ReminderContext)
  if (!ctx) throw new Error('useReminders must be used within ReminderProvider')
  return ctx
}

export function useReminderForTask(taskId) {
  const { remindersByTask } = useReminders()
  if (!taskId) return null
  return remindersByTask.get(String(taskId)) || null
}

export function describeTimeUntil(reminder) {
  if (!reminder?.remindAt) return ''
  const target = dayjs(reminder.remindAt)
  if (!target.isValid()) return ''
  const now = dayjs()
  const diffMinutes = target.diff(now, 'minute')
  if (diffMinutes <= 0) {
    const ago = Math.abs(diffMinutes)
    if (ago < 1) return 'due now'
    if (ago < 60) return `${ago}m overdue`
    const hours = Math.round(ago / 60)
    if (hours < 24) return `${hours}h overdue`
    const days = Math.round(hours / 24)
    return `${days}d overdue`
  }
  if (diffMinutes < 60) return `in ${diffMinutes}m`
  const hours = Math.round(diffMinutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}
