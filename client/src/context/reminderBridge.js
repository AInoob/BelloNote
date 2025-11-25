import { useMemo, useSyncExternalStore } from 'react'

const reminderSnapshot = new Map()
const reminderListeners = new Map()

const noopSubscribe = () => () => {}

const normalizeKey = (value) => {
  if (value == null) return null
  const key = String(value)
  return key.length ? key : null
}

const remindersEqual = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.status === b.status &&
    a.remindAt === b.remindAt &&
    a.message === b.message &&
    a.due === b.due &&
    a.taskTitle === b.taskTitle &&
    a.taskStatus === b.taskStatus
  )
}

const notifyKey = (key) => {
  const listeners = reminderListeners.get(key)
  if (!listeners || listeners.size === 0) return
  listeners.forEach((listener) => {
    try {
      listener()
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.error('[reminders] listener failed', error)
      }
    }
  })
}

const subscribeKey = (key, listener) => {
  let listeners = reminderListeners.get(key)
  if (!listeners) {
    listeners = new Set()
    reminderListeners.set(key, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) reminderListeners.delete(key)
  }
}

export function publishReminderSnapshot(list = []) {
  const prev = new Map(reminderSnapshot)
  const next = new Map()
  list.forEach((entry) => {
    const key = normalizeKey(entry?.taskId ?? entry?.id)
    if (!key) return
    next.set(key, entry)
  })

  reminderSnapshot.clear()
  next.forEach((value, key) => {
    reminderSnapshot.set(key, value)
  })

  const changedKeys = new Set()
  next.forEach((value, key) => {
    if (!remindersEqual(value, prev.get(key))) changedKeys.add(key)
  })
  prev.forEach((_, key) => {
    if (!next.has(key)) changedKeys.add(key)
  })

  if (changedKeys.size === 0) return
  changedKeys.forEach((key) => notifyKey(key))
}

export function useReminderEntry(taskId) {
  const key = normalizeKey(taskId)
  const subscribe = useMemo(() => {
    if (!key) return noopSubscribe
    return (listener) => subscribeKey(key, listener)
  }, [key])
  const getSnapshot = useMemo(() => {
    if (!key) return () => null
    return () => reminderSnapshot.get(key) || null
  }, [key])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
