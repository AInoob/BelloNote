import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useReminders } from '../context/ReminderContext.jsx'
import { describeTimeUntil } from '../utils/reminderTokens.js'
import { formatReminderAbsolute, isReminderDue } from '../utils/reminders.js'

const CUSTOM_DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm'
const SNOOZE_OPTIONS = [
  { label: '+10m', minutes: 10 },
  { label: '+30m', minutes: 30 },
  { label: '+1h', minutes: 60 },
  { label: '+2h', minutes: 120 }
]

function buildDefaultMoment(reminder) {
  if (reminder?.remindAt) {
    const parsed = dayjs(reminder.remindAt)
    if (parsed.isValid()) return parsed
  }
  return dayjs().add(30, 'minute')
}

function getReminderKey(reminder) {
  const raw = reminder?.taskId ?? reminder?.id
  return raw != null ? String(raw) : ''
}

function useCustomScheduler(scheduleReminder) {
  const [state, setState] = useState({ editingId: null, dateTime: '', error: '' })

  const reset = useCallback(() => {
    setState({ editingId: null, dateTime: '', error: '' })
  }, [])

  const open = useCallback((reminder) => {
    const key = getReminderKey(reminder)
    if (!key) {
      reset()
      return
    }
    const base = buildDefaultMoment(reminder)
    setState({
      editingId: key,
      dateTime: base.format(CUSTOM_DATETIME_FORMAT),
      error: ''
    })
  }, [reset])

  const setDateTime = useCallback((value) => {
    setState((current) => ({
      ...current,
      dateTime: value,
      error: current.error ? '' : current.error
    }))
  }, [])

  const setError = useCallback((message) => {
    setState((current) => ({ ...current, error: message }))
  }, [])

  const submit = useCallback(async (event, reminder) => {
    event.preventDefault()
    if (!reminder?.taskId) return
    if (!state.dateTime) {
      setError('Select a date and time')
      return
    }

    const parsed = dayjs(state.dateTime)
    if (!parsed.isValid()) {
      setError('Pick a valid date and time')
      return
    }

    const normalized = parsed.second(0).millisecond(0).toISOString()
    try {
      await scheduleReminder({
        taskId: reminder.taskId,
        remindAt: normalized,
        message: reminder.message || undefined
      })
      reset()
    } catch (error) {
      console.error('[reminders] failed to schedule custom date', error)
      setError(error?.message || 'Unable to update reminder')
    }
  }, [scheduleReminder, state.dateTime, reset, setError])

  const isEditing = useCallback((reminder) => state.editingId === getReminderKey(reminder), [state.editingId])

  return {
    open,
    close: reset,
    submit,
    setDateTime,
    isEditing,
    dateTime: state.dateTime,
    error: state.error
  }
}

export function ReminderNotificationBar({ visible, onNavigateOutline }) {
  const { pendingReminders, dismissReminder, completeReminder, scheduleReminder } = useReminders()
  const {
    open: openCustomPicker,
    close: resetCustomState,
    submit: submitCustomSchedule,
    setDateTime: setCustomDateTime,
    isEditing: isCustomEditing,
    dateTime: customDateTime,
    error: customError
  } = useCustomScheduler(scheduleReminder)

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

  const reschedule = useCallback(async (reminder, minutes) => {
    if (!reminder?.taskId) return
    try {
      const remindAt = dayjs().add(minutes, 'minute').second(0).millisecond(0).toISOString()
      await scheduleReminder({
        taskId: reminder.taskId,
        remindAt,
        message: reminder.message || undefined
      })
      if (isCustomEditing(reminder)) {
        resetCustomState()
      }
    } catch (error) {
      console.error('[reminders] failed to reschedule', error)
    }
  }, [scheduleReminder, isCustomEditing, resetCustomState])

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
        key: getReminderKey(reminder),
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
                  {SNOOZE_OPTIONS.map((option) => (
                    <button
                      key={option.minutes}
                      className="btn small ghost"
                      onClick={() => reschedule(reminder, option.minutes)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button className="btn small ghost" onClick={() => openCustomPicker(reminder)}>Custom…</button>
                {isCustomEditing(reminder) && (
                  <form className="reminder-custom" onSubmit={(event) => submitCustomSchedule(event, reminder)}>
                    <label className="field">
                      <span>Remind at</span>
                      <input
                        type="datetime-local"
                        value={customDateTime}
                        onChange={(event) => setCustomDateTime(event.target.value)}
                        required
                      />
                    </label>
                    <div className="reminder-custom-actions">
                      <button type="submit" className="btn small">Set</button>
                      <button type="button" className="btn small ghost" onClick={resetCustomState}>
                        Cancel
                      </button>
                    </div>
                    {customError && (
                      <span className="reminder-custom-error">{customError}</span>
                    )}
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
