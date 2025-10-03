import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useReminders } from '../context/ReminderContext.jsx'
import { usePendingReminderCount } from '../context/ReminderSelectors.js'
import { describeTimeUntil } from '../utils/reminderTokens.js'
import { formatReminderAbsolute, isReminderDue } from '../utils/reminders.js'
import { SNOOZE_DURATIONS, DEFAULT_REMINDER_OFFSET_MINUTES } from '../constants/reminders.js'

function buildDefaultMoment(reminder) {
  if (reminder?.remindAt) {
    const parsed = dayjs(reminder.remindAt)
    if (parsed.isValid()) return parsed
  }
  return dayjs().add(DEFAULT_REMINDER_OFFSET_MINUTES, 'minute')
}

const ReminderItemRow = memo(function ReminderItemRow({
  reminder,
  relativeLabel,
  absoluteLabel,
  isEditing,
  customDateTime,
  customError,
  onOpen,
  onKeyDown,
  onOpenCustom,
  onDateChange,
  onSubmitCustom,
  onCancelCustom,
  onReschedule,
  onComplete,
  onDismiss
}) {
  const key = String(reminder?.taskId ?? reminder?.id ?? '')
  const handleSubmit = useCallback((event) => onSubmitCustom(event, reminder), [onSubmitCustom, reminder])
  return (
    <div className="reminder-item" key={key}>
      <span
        className="reminder-title"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(reminder)}
        onKeyDown={(event) => onKeyDown(event, reminder)}
      >
        {reminder.taskTitle || `Task #${reminder.taskId}`}
      </span>
      <div className="reminder-meta">
        <button type="button" className="reminder-relative" onClick={() => onOpenCustom(reminder)}>
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
              onClick={() => onReschedule(reminder, minutes)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn small ghost" onClick={() => onOpenCustom(reminder)}>Custom…</button>
        {isEditing && (
          <form className="reminder-custom" onSubmit={handleSubmit}>
            <label className="field">
              <span>Remind at</span>
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(event) => onDateChange(event.target.value)}
                required
              />
            </label>
            <div className="reminder-custom-actions">
              <button type="submit" className="btn small">Set</button>
              <button type="button" className="btn small ghost" onClick={onCancelCustom}>Cancel</button>
            </div>
            {customError && <span className="reminder-custom-error">{customError}</span>}
          </form>
        )}
        <div className="reminder-complete-dismiss">
          <button className="btn small" onClick={() => onComplete(reminder)}>Mark complete</button>
          <button className="btn small ghost" onClick={() => onDismiss(reminder)}>Dismiss</button>
        </div>
      </div>
    </div>
  )
})
ReminderItemRow.displayName = 'ReminderItemRow'

function ReminderNotificationBarComponent({ visible, onNavigateOutline }) {
  const { pendingReminders, dismissReminder, completeReminder, scheduleReminder } = useReminders()
  const pendingCount = usePendingReminderCount()
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

  const handleCustomDateChange = useCallback((value) => {
    setCustomDateTime(value)
    setCustomError(prev => (prev ? '' : prev))
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

  const handleComplete = useCallback(async (reminder) => {
    const targetId = reminder?.taskId ?? reminder?.id
    if (!targetId) return
    await completeReminder(targetId)
    if (customEditingId === String(targetId)) resetCustomState()
  }, [completeReminder, customEditingId, resetCustomState])

  const handleDismiss = useCallback(async (reminder) => {
    const targetId = reminder?.taskId ?? reminder?.id
    if (!targetId) return
    await dismissReminder(targetId)
    if (customEditingId === String(targetId)) resetCustomState()
  }, [dismissReminder, customEditingId, resetCustomState])

  const remindersWithLabels = useMemo(() => pendingReminders.map((reminder) => {
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
  }), [pendingReminders])

  if (!visible || pendingCount === 0) return null

  return (
    <div className="reminder-banner">
      <div className="reminder-banner-inner">
        <strong>
          {pendingCount === 1 ? 'Reminder due' : `${pendingCount} reminders due`}
        </strong>
        <div className="reminder-items">
          {remindersWithLabels.map(({ reminder, key, relativeLabel, absoluteLabel }) => (
            <ReminderItemRow
              key={key}
              reminder={reminder}
              relativeLabel={relativeLabel}
              absoluteLabel={absoluteLabel}
              isEditing={customEditingId === key}
              customDateTime={customDateTime}
              customError={customError}
              onOpen={openInOutline}
              onKeyDown={handleReminderKeyDown}
              onOpenCustom={openCustomPicker}
              onDateChange={handleCustomDateChange}
              onSubmitCustom={handleCustomSubmit}
              onCancelCustom={resetCustomState}
              onReschedule={reschedule}
              onComplete={handleComplete}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export const ReminderNotificationBar = memo(ReminderNotificationBarComponent)
