import React, { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import OutlinerView from './OutlinerView.jsx'
import { getOutline } from '../api.js'
import { describeTimeUntil, useReminders } from '../context/ReminderContext.jsx'

const FILTER_OPTIONS = [
  { key: 'due', label: 'Due / Overdue' },
  { key: 'upcoming', label: 'Scheduled' },
  { key: 'completed', label: 'Completed' },
  { key: 'dismissed', label: 'Dismissed' }
]

const STATUS_ORDER = ['due', 'upcoming', 'completed', 'dismissed']

function reminderStatusKey(reminder) {
  if (!reminder) return 'upcoming'
  if (reminder.status === 'completed') return 'completed'
  if (reminder.status === 'dismissed') return 'dismissed'
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
    if (reminder.status === 'scheduled') {
      if (reminder.due || (reminder.remindAt && dayjs(reminder.remindAt).isBefore(dayjs()))) {
        infoParts.push('Reminder due')
      } else {
        const relative = describeTimeUntil(reminder)
        if (relative) infoParts.push(`Reminds ${relative}`)
      }
    } else if (reminder.status === 'completed') {
      infoParts.push('Reminder completed')
    } else if (reminder.status === 'dismissed') {
      infoParts.push('Reminder dismissed')
    }
    const absolute = formatAbsolute(reminder)
    if (absolute) infoParts.push(absolute)
    const infoText = infoParts.join(' • ')

    const titleText = reminder.taskTitle || `Task #${reminder.taskId}`
    const content = [
      { type: 'paragraph', content: [{ type: 'text', text: titleText }] }
    ]
    if (infoText) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: infoText }] })
    }
    const baseNode = outlineMap.get(String(reminder.taskId))

    const result = {
      id: reminder.taskId,
      title: titleText,
      status: reminder.taskStatus || 'todo',
      content,
      children: []
    }
    if (baseNode && reminderStatusKey(reminder) === 'due') {
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
    ;(async () => {
      try {
        const data = await getOutline()
        const map = new Map()
        const walk = (nodes) => {
          nodes.forEach(node => {
            if (!node || typeof node !== 'object') return
            if (node.id != null) map.set(String(node.id), node)
            if (Array.isArray(node.children)) walk(node.children)
          })
        }
        if (data?.roots) walk(data.roots)
        if (!cancelled) setOutlineMap(map)
      } catch (err) {
        console.error('[reminders] failed to fetch outline', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const categorized = useMemo(() => {
    const buckets = {
      due: [],
      upcoming: [],
      completed: [],
      dismissed: []
    }
    reminders.forEach(reminder => {
      const key = reminderStatusKey(reminder)
      buckets[key].push(reminder)
    })
    buckets.due.sort((a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0))
    buckets.upcoming.sort((a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0))
    buckets.completed.sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0))
    buckets.dismissed.sort((a, b) => new Date(b.dismissedAt || b.updatedAt || 0) - new Date(a.dismissedAt || a.updatedAt || 0))
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
          />
        </div>
      )}
    </section>
  )
}
