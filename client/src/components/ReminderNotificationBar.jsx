import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useReminders } from '../context/ReminderContext.jsx'
import { describeTimeUntil } from '../utils/reminderTokens.js'
import { formatReminderAbsolute, isReminderDue } from '../utils/reminders.js'

// ============================================================================
// Reminder Notification Bar Component
// Shows a banner for due/overdue reminders with action buttons
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Builds a default datetime moment for a reminder
 * Uses existing remindAt or defaults to 30 minutes from now
 * @param {Object} reminder - Reminder object
 * @returns {dayjs.Dayjs} Default datetime moment
 */
function buildDefaultMoment(reminder) {
  if (reminder?.remindAt) {
    const parsed = dayjs(reminder.remindAt)
    if (parsed.isValid()) return parsed
  }
  return dayjs().add(30, 'minute')
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * ReminderNotificationBar Component
 * Displays a banner with pending reminders and actions
 * @param {Object} props - Component props
 * @param {boolean} props.visible - Whether the bar should be visible
 * @param {Function} props.onNavigateOutline - Callback to navigate to task in outline
 */
export function ReminderNotificationBar({ visible, onNavigateOutline }) {
  // Context and state
  const { pendingReminders, dismissReminder, completeReminder, scheduleReminder } = useReminders()
  const [customEditingId, setCustomEditingId] = useState(null)
  const [customDateTime, setCustomDateTime] = useState('')
  const [customError, setCustomError] = useState('')

  // Debug logging for pending reminders
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.log(
        '[reminder-notification] pending reminders updated',
        pendingReminders.map((reminder) => ({
          id: reminder.taskId,
          status: reminder.status,
          remindAt: reminder.remindAt,
          due: reminder.due
        }))
      )
    }
  }, [pendingReminders])

  // Custom datetime picker handlers
  const resetCustomState = useCallback(() => {
    setCustomEditingId(null)
    setCustomDateTime('')
    setCustomError('')
  }, [])

  const openCustomPicker = useCallback((reminder) => {
    const base = buildDefaultMoment(reminder)
    const key = reminder?.taskId ?? reminder?.id
    setCustomEditingId(key != null ? String(key) : null)
    setCustomDateTime(base.format('YYYY-MM-DDTHH:mm'))
    setCustomError('')
  }, [])

  const handleCustomSubmit = useCallback(async (event, reminder) => {
    event.preventDefault()
    if (!reminder?.taskId) return

    // Validate datetime input
    if (!customDateTime) {
      setCustomError('Select a date and time')
      return
    }

    let combined = dayjs(customDateTime)
    if (!combined.isValid()) {
      setCustomError('Pick a valid date and time')
      return
    }

    // Normalize to zero seconds/milliseconds
    combined = combined.second(0).millisecond(0)

    try {
      await scheduleReminder({
        taskId: reminder.taskId,
        remindAt: combined.toISOString(),
        message: reminder.message || undefined
      })
      resetCustomState()
    } catch (error) {
      console.error('[reminders] failed to schedule custom date', error)
      setCustomError(error?.message || 'Unable to update reminder')
    }
  }, [customDateTime, resetCustomState, scheduleReminder])

  // Quick reschedule actions (+10m, +30m, etc.)
  const reschedule = useCallback(async (reminder, minutes) => {
    if (!reminder?.taskId) return

    try {
      const remindAt = dayjs()
        .add(minutes, 'minute')
        .second(0)
        .millisecond(0)
        .toISOString()

      await scheduleReminder({
        taskId: reminder.taskId,
        remindAt,
        message: reminder.message || undefined
      })

      // Close custom picker if it's open for this reminder
      if (customEditingId === String(reminder?.taskId ?? reminder?.id ?? '')) {
        resetCustomState()
      }
    } catch (error) {
      console.error('[reminders] failed to reschedule', error)
    }
  }, [customEditingId, resetCustomState, scheduleReminder])

  // Navigation handlers
  const openInOutline = useCallback((reminder) => {
    if (!reminder?.taskId) return
    onNavigateOutline?.({
      taskId: reminder.taskId,
      reminderId: reminder.id,
      remindAt: reminder.remindAt
    })
  }, [onNavigateOutline])

  const handleReminderKeyDown = useCallback((event, reminder) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openInOutline(reminder)
    }
  }, [openInOutline])

  // Compute display labels for each reminder
  const remindersWithLabels = useMemo(() => {
    return pendingReminders.map((reminder) => {
      const status = reminder?.status || 'incomplete'
      const due = isReminderDue(reminder)
      const relative = describeTimeUntil(reminder)

      // Determine relative label based on status
      let relativeLabel = 'Set reminder time'
      if (status === 'dismissed') {
        relativeLabel = 'Reminder dismissed'
      } else if (status === 'completed') {
        relativeLabel = 'Reminder completed'
      } else if (due) {
        relativeLabel = 'Reminder due'
      } else if (relative) {
        relativeLabel = `Reminds ${relative}`
      }

      return {
        reminder,
        key: String(reminder?.taskId ?? reminder?.id ?? ''),
        relativeLabel,
        absoluteLabel: formatReminderAbsolute(reminder)
      }
    })
  }, [pendingReminders])

  // Don't render if not visible
  if (!visible) return null

  return (
    <div className="reminder-banner">
      <div className="reminder-banner-inner">
        <strong>
          {pendingReminders.length === 1 ? 'Reminder due' : `${pendingReminders.length} reminders due`}
        </strong>
        <div className="reminder-items">
          {remindersWithLabels.map(({ reminder, key, relativeLabel, absoluteLabel }) => (
            <div key={key} className="reminder-item">
              <span
                className="reminder-title"
                role="button"
                tabIndex={0}
                onClick={() => openInOutline(reminder)}
                onKeyDown={(event) => handleReminderKeyDown(event, reminder)}
              >
                {reminder.taskTitle || `Task #${reminder.taskId}`}
              </span>
              <div className="reminder-meta">
                <button type="button" className="reminder-relative" onClick={() => openCustomPicker(reminder)}>
                  {relativeLabel}
                </button>
                {absoluteLabel && <span className="reminder-absolute">{absoluteLabel}</span>}
              </div>
              <div className="reminder-actions">
                <div className="reminder-snooze" aria-label="Reschedule reminder">
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 10)}>+10m</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 30)}>+30m</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 60)}>+1h</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 120)}>+2h</button>
                </div>
                <button className="btn small ghost" onClick={() => openCustomPicker(reminder)}>Custom…</button>
                {customEditingId === key && (
                  <form className="reminder-custom" onSubmit={(event) => handleCustomSubmit(event, reminder)}>
                    <label className="field">
                      <span>Remind at</span>
                      <input
                        type="datetime-local"
                        value={customDateTime}
                        onChange={(event) => {
                          setCustomDateTime(event.target.value)
                          if (customError) setCustomError('')
                        }}
                        required
                      />
                    </label>
                    <div className="reminder-custom-actions">
                      <button type="submit" className="btn small">Set</button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={resetCustomState}
                      >
                        Cancel
                      </button>
                    </div>
                    {customError && <span className="reminder-custom-error">{customError}</span>}
                  </form>
                )}
                <button className="btn small" onClick={() => completeReminder(reminder.taskId ?? reminder.id)}>Mark complete</button>
                <button className="btn small ghost" onClick={() => dismissReminder(reminder.taskId ?? reminder.id)}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
