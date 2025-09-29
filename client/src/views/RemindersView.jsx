import React, { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import OutlinerView from './OutlinerView.jsx'
import { getOutline } from '../api.js'
import { useReminders } from '../context/ReminderContext.jsx'
import { computeReminderDisplay } from '../utils/reminderTokens.js'

const FILTER_OPTIONS = [
  { key: 'due', label: 'Due / Overdue' },
  { key: 'upcoming', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' }
]

const STATUS_ORDER = ['due', 'upcoming', 'completed']

function reminderStatusKey(reminder) {
  if (!reminder) return 'upcoming'
  if (reminder.status === 'completed') return 'completed'
  const isDue = reminder.due || (reminder.remindAt && dayjs(reminder.remindAt).isBefore(dayjs()))
  return isDue ? 'due' : 'upcoming'
}

function formatAbsolute(reminder) {
  if (!reminder?.remindAt) return ''
  const date = dayjs(reminder.remindAt)
  if (!date.isValid()) return ''
  return date.format('MMM D, YYYY h:mm A')
}

function cloneNodes(nodes) {
  if (!Array.isArray(nodes)) return []
  return nodes.map(node => ({
    ...node,
    content: Array.isArray(node.content) ? JSON.parse(JSON.stringify(node.content)) : node.content,
    children: cloneNodes(node.children)
  }))
}

function buildOutlineRoots(reminders, outlineMap) {
  return reminders.map(reminder => {
    const infoParts = []
    const display = computeReminderDisplay(reminder)
    if (display.summary) infoParts.push(display.summary)
    const absolute = formatAbsolute(reminder)
    if (absolute) infoParts.push(absolute)
    const infoText = infoParts.join(' • ')

    const baseNode = outlineMap.get(String(reminder.taskId))
    const titleText = reminder.taskTitle || `Task #${reminder.taskId}`
    const content = baseNode && Array.isArray(baseNode.content)
      ? cloneNodes(baseNode.content)
      : [{ type: 'paragraph', content: [{ type: 'text', text: titleText }] }]
    if (infoText) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: infoText, attrs: { 'data-reminder-summary': '1' } }] })
    }

    const result = {
      id: reminder.taskId,
      title: titleText,
      status: reminder.taskStatus ?? '',
      content,
      children: []
    }
    if (baseNode) {
      result.children = cloneNodes(baseNode.children)
    }
    return result
  })
}

export default function RemindersView() {
  const { reminders } = useReminders()
  const [statusFilters, setStatusFilters] = useState(() => new Set(STATUS_ORDER))
  const [outlineMap, setOutlineMap] = useState(() => new Map())

  useEffect(() => {
    let cancelled = false
    const applyRoots = (roots = []) => {
      const map = new Map()
      const walk = (nodes) => {
        nodes.forEach(node => {
          if (!node || typeof node !== 'object') return
          if (node.id != null) map.set(String(node.id), node)
          if (Array.isArray(node.children)) walk(node.children)
        })
      }
      walk(roots)
      if (!cancelled) setOutlineMap(map)
    }

    ;(async () => {
      try {
        const data = await getOutline()
        applyRoots(Array.isArray(data?.roots) ? data.roots : [])
      } catch (err) {
        console.error('[reminders] failed to fetch outline', err)
      }
    })()

    const handler = (event) => {
      const roots = event?.detail?.outline
      if (Array.isArray(roots)) applyRoots(roots)
    }
    window.addEventListener('worklog:outline-snapshot', handler)
    return () => {
      cancelled = true
      window.removeEventListener('worklog:outline-snapshot', handler)
    }
  }, [])

  const categorized = useMemo(() => {
    const buckets = {
      due: [],
      upcoming: [],
      completed: []
    }
    reminders.forEach(reminder => {
      const key = reminderStatusKey(reminder)
      buckets[key].push(reminder)
    })
    buckets.due.sort((a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0))
    buckets.upcoming.sort((a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0))
    buckets.completed.sort((a, b) => new Date(b.remindAt || 0) - new Date(a.remindAt || 0))
    return buckets
  }, [reminders])

  const filteredReminders = useMemo(() => {
    const active = statusFilters.size ? Array.from(statusFilters) : STATUS_ORDER
    return active.flatMap(key => categorized[key] || [])
  }, [categorized, statusFilters])

  const outlineRoots = useMemo(() => buildOutlineRoots(filteredReminders, outlineMap), [filteredReminders, outlineMap])
  const outlinePayload = useMemo(() => ({ roots: outlineRoots }), [outlineRoots])

  const toggleFilter = (key) => {
    setStatusFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <section className="reminders-view">
      <header className="reminders-header">
        <h2>Reminders</h2>
        <div className="reminder-filters">
          {FILTER_OPTIONS.map(option => (
            <label key={option.key} className={`filter-pill ${statusFilters.has(option.key) ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={statusFilters.has(option.key)}
                onChange={() => toggleFilter(option.key)}
              />
              <span>{option.label}</span>
              <span className="tab-count">{categorized[option.key]?.length || 0}</span>
            </label>
          ))}
        </div>
      </header>

      {outlineRoots.length === 0 ? (
        <div className="reminder-empty">No reminders match the selected filters.</div>
      ) : (
        <div className="reminder-outline">
          <OutlinerView
            readOnly
            initialOutline={outlinePayload}
            forceExpand
            showDebug={false}
            reminderActionsEnabled
            broadcastSnapshots={false}
          />
        </div>
      )}
    </section>
  )
}
