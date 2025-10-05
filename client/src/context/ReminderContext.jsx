import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getOutline } from '../api.js'
import { parseReminderFromNodeContent, reminderIsDue, REMINDER_DISPLAY_BREAK } from '../utils/reminderTokens.js'
import { REMINDER_POLL_INTERVAL_MS, PLAYWRIGHT_TEST_HOSTS } from '../constants/config.js'

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

// -------------------- Performance helpers --------------------
const NODE_SIG_CACHE = new Map()
const REMINDER_CACHE = new Map()

function detectE2EEnvironment() {
  if (typeof window === 'undefined') return false
  try {
    const { hostname, port } = window.location
    const numericPort = Number(port || 0)
    const hostWithPort = port ? `${hostname}:${port}` : hostname
    const hostMatch = PLAYWRIGHT_TEST_HOSTS?.has?.(hostname) || PLAYWRIGHT_TEST_HOSTS?.has?.(hostWithPort)
    const portMatch = Number.isFinite(numericPort) && numericPort >= 6000 && numericPort <= 7999
    const envMatch = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_E2E === '1'
    const userAgentMatch = typeof navigator !== 'undefined' && /playwright/i.test(navigator.userAgent || '')
    const webdriverMatch = typeof navigator !== 'undefined' && navigator.webdriver === true
    return Boolean(hostMatch || portMatch || envMatch || userAgentMatch || webdriverMatch)
  } catch {
    return false
  }
}

function maybeHasReminderInContent(content, cap = 512) {
  const displayPrefix = `[[${REMINDER_DISPLAY_BREAK}reminder`
  if (typeof content === 'string') {
    return content.includes('[[reminder') || content.includes(displayPrefix)
  }
  if (!Array.isArray(content) || content.length === 0) return false
  const stack = content.slice()
  let remaining = cap
  while (stack.length && remaining > 0) {
    const current = stack.pop()
    if (!current) continue
    if (typeof current.text === 'string') {
      const text = current.text
      remaining -= text.length
      if (text.includes('[[reminder') || text.includes(displayPrefix)) return true
    }
    if (Array.isArray(current.content)) {
      for (let i = 0; i < current.content.length && i < 12; i += 1) stack.push(current.content[i])
    }
  }
  return false
}

function computeNodeSignature(node) {
  if (!node || typeof node !== 'object') return '0'
  let hash = 0
  const idStr = node.id == null ? '' : String(node.id)
  const statusStr = node.status ? String(node.status) : ''
  const titleStr = node.title ? String(node.title) : ''

  hash = ((hash << 5) - hash + idStr.length) | 0
  hash = ((hash << 5) - hash + statusStr.length) | 0
  hash = ((hash << 5) - hash + titleStr.length) | 0

  let sampled = 0
  const stack = []
  if (Array.isArray(node.content)) stack.push(...node.content)
  else if (typeof node.content === 'string' && node.content) stack.push({ text: node.content })
  while (stack.length && sampled < 256) {
    const current = stack.pop()
    if (!current) continue
    if (typeof current.text === 'string') {
      const text = current.text
      const length = text.length
      sampled += length
      hash = ((hash << 5) - hash + length) | 0
      if (length > 0) {
        const step = Math.max(1, Math.floor(length / 64))
        for (let i = 0; i < length; i += step) {
          hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
        }
        hash = ((hash << 5) - hash + text.charCodeAt(0)) | 0
        hash = ((hash << 5) - hash + text.charCodeAt(length - 1)) | 0
      }
    }
    if (Array.isArray(current.content)) {
      for (let i = 0; i < current.content.length && i < 8; i += 1) stack.push(current.content[i])
    }
  }
  return hash.toString(36)
}

function buildReminderEntry(node, parsed) {
  if (!parsed) return null
  const id = node?.id != null ? String(node.id) : null
  if (!id) return null
  return {
    id,
    taskId: id,
    taskTitle: node.title || '',
    taskStatus: node.status || '',
    status: parsed.status || 'incomplete',
    remindAt: parsed.remindAt || '',
    message: parsed.message || '',
    token: parsed.token || '',
    due: reminderIsDue(parsed)
  }
}

function buildReminderExtractionPlan(roots = [], { useWorker = false } = {}) {
  const order = []
  const pending = []
  const seenIds = new Set()
  const stack = Array.isArray(roots) ? roots.slice() : []

  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue

    const id = node.id != null ? String(node.id) : null
    if (id) seenIds.add(id)

    const signature = computeNodeSignature(node)
    const cachedSignature = id ? NODE_SIG_CACHE.get(id) : null

    if (id && signature === cachedSignature) {
      const cachedReminder = REMINDER_CACHE.get(id)
      if (cachedReminder) {
        const due = reminderIsDue(cachedReminder)
        if (due !== cachedReminder.due) {
          const refreshed = { ...cachedReminder, due }
          REMINDER_CACHE.set(id, refreshed)
          order.push({ id, reminder: refreshed })
        } else {
          order.push({ id, reminder: cachedReminder })
        }
      }
    } else if (id) {
      if (maybeHasReminderInContent(node.content)) {
        if (useWorker) {
          NODE_SIG_CACHE.set(id, signature)
          REMINDER_CACHE.set(id, null)
          const orderIndex = order.length
          order.push({ id, reminder: null })
          pending.push({
            id,
            title: node.title || '',
            status: node.status || '',
            content: node.content,
            orderIndex
          })
        } else {
          const parsed = parseReminderFromNodeContent(node?.content)
          const reminderEntry = buildReminderEntry(node, parsed)
          NODE_SIG_CACHE.set(id, signature)
          REMINDER_CACHE.set(id, reminderEntry)
          if (reminderEntry) order.push({ id, reminder: reminderEntry })
        }
      } else {
        NODE_SIG_CACHE.set(id, signature)
        REMINDER_CACHE.set(id, null)
      }
    }

    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i += 1) {
        stack.push(node.children[i])
      }
    }
  }

  if (NODE_SIG_CACHE.size > seenIds.size) {
    for (const key of NODE_SIG_CACHE.keys()) {
      if (!seenIds.has(key)) {
        NODE_SIG_CACHE.delete(key)
        REMINDER_CACHE.delete(key)
      }
    }
  }

  return { order, pending }
}

export function ReminderProvider({ children }) {
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(true)
  const lastSnapshotRef = useRef('')
  const idleTaskRef = useRef(null)
  const refreshControllerRef = useRef(null)
  const workerRef = useRef(null)
  const pendingPlanRef = useRef(null)
  const parseSequenceRef = useRef(0)

  const isE2EEnvironment = useMemo(() => detectE2EEnvironment(), [])

  const finalizeReminders = useCallback((order, roots) => {
    const next = order
      .map(entry => entry.reminder)
      .filter(Boolean)
    const key = JSON.stringify((next || []).map(item => `${item.taskId}|${item.status}|${item.remindAt}`))
    if (lastSnapshotRef.current === key) return
    lastSnapshotRef.current = key
    setReminders(next)
    if (typeof window !== 'undefined') {
      window.__WORKLOG_REMINDERS = next
      window.__WORKLOG_REMINDER_OUTLINE = roots
    }
  }, [])

  const handleWorkerMessage = useCallback((event) => {
    const { data } = event || {}
    if (!data || data.type !== 'scan-result') return
    const { requestId, results } = data
    const plan = pendingPlanRef.current
    if (!plan || plan.requestId !== requestId) return

    const resultMap = new Map()
    if (Array.isArray(results)) {
      results.forEach(item => {
        if (!item || item.id == null) return
        resultMap.set(String(item.id), item.reminder || null)
      })
    }

    const order = plan.order.map(entry => {
      if (entry.reminder) {
        const due = reminderIsDue(entry.reminder)
        if (due !== entry.reminder.due) {
          const refreshed = { ...entry.reminder, due }
          REMINDER_CACHE.set(entry.id, refreshed)
          return { id: entry.id, reminder: refreshed }
        }
        REMINDER_CACHE.set(entry.id, entry.reminder)
        return entry
      }
      const result = resultMap.has(entry.id) ? resultMap.get(entry.id) : null
      if (result) {
        const due = reminderIsDue(result)
        const refreshed = due === result.due ? result : { ...result, due }
        REMINDER_CACHE.set(entry.id, refreshed)
        return { id: entry.id, reminder: refreshed }
      }
      REMINDER_CACHE.set(entry.id, null)
      return { id: entry.id, reminder: null }
    })

    pendingPlanRef.current = null
    finalizeReminders(order, plan.roots)
  }, [finalizeReminders])

  useEffect(() => {
    if (isE2EEnvironment) return undefined
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return undefined
    try {
      const worker = new Worker(new URL('../workers/reminderScan.worker.js', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.addEventListener('message', handleWorkerMessage)
      const errorHandler = (err) => {
        console.error('[reminders] worker error', err)
      }
      worker.addEventListener('error', errorHandler)
      return () => {
        worker.removeEventListener('message', handleWorkerMessage)
        worker.removeEventListener('error', errorHandler)
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
    } catch (error) {
      console.error('[reminders] failed to start worker', error)
      workerRef.current = null
    }
    return undefined
  }, [handleWorkerMessage, isE2EEnvironment])

  const runExtraction = useCallback((roots) => {
    const useWorker = !isE2EEnvironment && workerRef.current
    const { order, pending } = buildReminderExtractionPlan(roots, { useWorker: Boolean(useWorker) })

    if (!useWorker || pending.length === 0) {
      pendingPlanRef.current = null
      finalizeReminders(order, roots)
      return
    }

    const requestId = parseSequenceRef.current + 1
    parseSequenceRef.current = requestId
    pendingPlanRef.current = { requestId, order, roots }

    try {
      workerRef.current.postMessage({
        type: 'scan',
        requestId,
        nodes: pending.map(({ id, title, status, content }) => ({ id, title, status, content }))
      })
    } catch (error) {
      console.error('[reminders] worker dispatch failed, falling back to sync parse', error)
      const fallback = buildReminderExtractionPlan(roots, { useWorker: false })
      pendingPlanRef.current = null
      finalizeReminders(fallback.order, roots)
    }
  }, [finalizeReminders, isE2EEnvironment])

  const updateFromOutline = useCallback((roots) => {
    const performParse = () => runExtraction(roots)

    if (isE2EEnvironment) {
      performParse()
      return
    }

    if (typeof requestIdleCallback === 'function') {
      if (idleTaskRef.current && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleTaskRef.current)
      }
      idleTaskRef.current = requestIdleCallback(() => {
        idleTaskRef.current = null
        performParse()
      }, { timeout: 120 })
    } else {
      setTimeout(performParse, 0)
    }
  }, [isE2EEnvironment, runExtraction])

  const refreshReminders = useCallback(async () => {
    let controller = null
    try {
      if (refreshControllerRef.current) {
        try { refreshControllerRef.current.abort() } catch {}
      }
      controller = (typeof AbortController !== 'undefined') ? new AbortController() : null
      if (controller) refreshControllerRef.current = controller
      const data = await getOutline(controller ? { signal: controller.signal } : undefined)
      updateFromOutline(Array.isArray(data?.roots) ? data.roots : [])
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') {
        return
      }
      console.error('[reminders] failed to load outline', err)
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null
        setLoading(false)
      } else if (!refreshControllerRef.current) {
        setLoading(false)
      }
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

  useEffect(() => () => {
    if (idleTaskRef.current && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleTaskRef.current)
      idleTaskRef.current = null
    }
    if (refreshControllerRef.current) {
      try { refreshControllerRef.current.abort() } catch {}
      refreshControllerRef.current = null
    }
    pendingPlanRef.current = null
    parseSequenceRef.current = 0
    NODE_SIG_CACHE.clear()
    REMINDER_CACHE.clear()
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
