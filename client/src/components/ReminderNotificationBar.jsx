import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useReminders } from '../context/ReminderContext.jsx'
import { describeTimeUntil } from '../utils/reminderTokens.js'
import { formatReminderAbsolute, isReminderDue } from '../utils/reminders.js'
import { SNOOZE_DURATIONS, DEFAULT_REMINDER_OFFSET_MINUTES } from '../constants/reminders.js'

/**
 * Build a default moment for custom reminder scheduling
 * Uses existing reminder time or defaults to 30 minutes from now
 */
function buildDefaultMoment(reminder) {
  if (reminder?.remindAt) {
    const parsed = dayjs(reminder.remindAt)
    if (parsed.isValid()) return parsed
  }
  return dayjs().add(DEFAULT_REMINDER_OFFSET_MINUTES, 'minute')
}

/**
 * Notification bar for due reminders
 * Shows pending reminders with snooze and completion actions
 *
 * @param {boolean} visible - Whether the bar should be visible
 * @param {Function} onNavigateOutline - Handler to navigate to task in outline
 */
export function ReminderNotificationBar({ visible, onNavigateOutline }) {
  const { pendingReminders, dismissReminder, completeReminder, scheduleReminder } = useReminders()
  const [customEditingId, setCustomEditingId] = useState(null)
  const [customDateTime, setCustomDateTime] = useState('')
  const [customError, setCustomError] = useState('')

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
    if (!customDateTime) {
      setCustomError('Select a date and time')
      return
    }
    let combined = dayjs(customDateTime)
    if (!combined.isValid()) {
      setCustomError('Pick a valid date and time')
      return
    }
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

  const reschedule = useCallback(async (reminder, minutes) => {
    if (!reminder?.taskId) return
    try {
      const remindAt = dayjs().add(minutes, 'minute').second(0).millisecond(0).toISOString()
      await scheduleReminder({
        taskId: reminder.taskId,
        remindAt,
        message: reminder.message || undefined
      })
      if (customEditingId === String(reminder?.taskId ?? reminder?.id ?? '')) {
        resetCustomState()
      }
    } catch (error) {
      console.error('[reminders] failed to reschedule', error)
    }
  }, [customEditingId, resetCustomState, scheduleReminder])

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

  const remindersWithLabels = useMemo(() => {
    return pendingReminders.map((reminder) => {
      const status = reminder?.status || 'incomplete'
      const due = isReminderDue(reminder)
      const relative = describeTimeUntil(reminder)

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
                  {SNOOZE_DURATIONS.map(({ minutes, label }) => (
                    <button
                      key={minutes}
                      className="btn small ghost"
                      onClick={() => reschedule(reminder, minutes)}
                    >
                      {label}
                    </button>
                  ))}
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
