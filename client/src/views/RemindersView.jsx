// ============================================================================
// Reminders View Component
// Displays all reminders grouped by status with filtering
// ============================================================================

import React, { useMemo, useState } from 'react'
import OutlinerView from './OutlinerView.jsx'
import { useReminders } from '../context/ReminderContext.jsx'
import { useOutlineSnapshot } from '../hooks/useOutlineSnapshot.js'
import { bucketRemindersByStatus } from '../utils/reminderBuckets.js'
import { buildReminderOutlineRoots } from '../utils/reminderOutline.js'
import { REMINDER_FILTERS, REMINDER_STATUS_ORDER } from '../utils/reminders.js'

/**
 * RemindersView Component
 * Displays tasks with reminders, filtered by status (overdue, today, upcoming, etc.)
 * Shows tasks in their original outline hierarchy
 */
export default function RemindersView() {
  // ============================================================================
  // State and Data
  // ============================================================================

  const { reminders } = useReminders()
  const [statusFilters, setStatusFilters] = useState(() => new Set(REMINDER_STATUS_ORDER))
  const { outlineMap } = useOutlineSnapshot()

  // ============================================================================
  // Computed Values
  // ============================================================================

  // Group reminders by status bucket (overdue, today, upcoming, etc.)
  const categorized = useMemo(() => {
    return bucketRemindersByStatus(reminders)
  }, [reminders])

  // Filter reminders based on active status filters
  const filteredReminders = useMemo(() => {
    const active = statusFilters.size ? Array.from(statusFilters) : REMINDER_STATUS_ORDER
    return active.flatMap(key => categorized[key] || [])
  }, [categorized, statusFilters])

  // Build outline tree from filtered reminders
  const outlineRoots = useMemo(
    () => buildReminderOutlineRoots(filteredReminders, outlineMap),
    [filteredReminders, outlineMap]
  )
  const outlinePayload = useMemo(() => ({ roots: outlineRoots }), [outlineRoots])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Toggles a status filter on/off
   * @param {string} key - Status filter key
   */
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

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <section className="reminders-view">
      {/* Header with title and status filters */}
      <header className="reminders-header">
        <h2>Reminders</h2>
        <div className="reminder-filters">
          {REMINDER_FILTERS.map(option => (
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

      {/* Empty state or outline view */}
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
