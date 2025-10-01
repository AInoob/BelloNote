import React, { useCallback, useMemo, useState } from 'react'
import OutlinerView from './OutlinerView.jsx'
import { useReminders } from '../context/ReminderContext.jsx'
import { useOutlineSnapshot } from '../hooks/useOutlineSnapshot.js'
import { bucketRemindersByStatus } from '../utils/reminderBuckets.js'
import { buildReminderOutlineRoots } from '../utils/reminderOutline.js'
import { REMINDER_FILTERS, REMINDER_STATUS_ORDER } from '../utils/reminders.js'

function useReminderFilters() {
  const [selected, setSelected] = useState(() => new Set(REMINDER_STATUS_ORDER))

  const toggle = useCallback((key) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isActive = useCallback((key) => selected.has(key), [selected])

  const activeKeys = useMemo(() => {
    if (selected.size === 0) return REMINDER_STATUS_ORDER
    return Array.from(selected)
  }, [selected])

  return { toggle, isActive, activeKeys }
}

function ReminderFilterPill({ option, isActive, count, onToggle }) {
  const handleChange = useCallback(() => {
    onToggle(option.key)
  }, [onToggle, option.key])

  return (
    <label className={`filter-pill ${isActive ? 'active' : ''}`}>
      <input type="checkbox" checked={isActive} onChange={handleChange} />
      <span>{option.label}</span>
      <span className="tab-count">{count}</span>
    </label>
  )
}

function useReminderOutline(reminders, outlineMap, activeKeys) {
  const categorized = useMemo(() => bucketRemindersByStatus(reminders), [reminders])

  const filteredReminders = useMemo(() => {
    return activeKeys.flatMap((key) => categorized[key] || [])
  }, [activeKeys, categorized])

  const outlineRoots = useMemo(() => (
    buildReminderOutlineRoots(filteredReminders, outlineMap)
  ), [filteredReminders, outlineMap])

  return {
    categorized,
    outlinePayload: useMemo(() => ({ roots: outlineRoots }), [outlineRoots]),
    hasReminders: outlineRoots.length > 0
  }
}

export default function RemindersView() {
  const { reminders } = useReminders()
  const { outlineMap } = useOutlineSnapshot()
  const { toggle, isActive, activeKeys } = useReminderFilters()
  const { categorized, outlinePayload, hasReminders } = useReminderOutline(reminders, outlineMap, activeKeys)

  return (
    <section className="reminders-view">
      <header className="reminders-header">
        <h2>Reminders</h2>
        <div className="reminder-filters">
          {REMINDER_FILTERS.map((option) => (
            <ReminderFilterPill
              key={option.key}
              option={option}
              isActive={isActive(option.key)}
              count={categorized[option.key]?.length || 0}
              onToggle={toggle}
            />
          ))}
        </div>
      </header>

      {hasReminders ? (
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
      ) : (
        <div className="reminder-empty">No reminders match the selected filters.</div>
      )}
    </section>
  )
}
