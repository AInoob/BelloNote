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
  const status = reminder?.status || 'incomplete'
  const isIncomplete = status === 'incomplete'
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
        {isIncomplete && (
          <div className="reminder-complete-dismiss">
            <button className="btn small" onClick={() => onComplete(reminder)}>Mark complete</button>
            <button className="btn small ghost" onClick={() => onDismiss(reminder)}>Dismiss</button>
          </div>
        )}
      </div>
    </div>
  )
})
ReminderItemRow.displayName = 'ReminderItemRow'

function ReminderNotificationBarComponent({ visible, onNavigateOutline }) {
  const {
    pendingReminders,
    upcomingReminders,
    completedReminders,
    dismissReminder,
    completeReminder,
    scheduleReminder
  } = useReminders()
  const pendingCount = usePendingReminderCount()
  const hasUpcoming = upcomingReminders.length > 0
  const hasCompleted = completedReminders.length > 0
  const [activeTab, setActiveTab] = useState(() => {
    if (pendingReminders.length > 0) return 'due'
    if (upcomingReminders.length > 0) return 'upcoming'
    if (completedReminders.length > 0) return 'completed'
    return 'due'
  })
  const [customEditingId, setCustomEditingId] = useState(null)
  const [customDateTime, setCustomDateTime] = useState('')
  const [customError, setCustomError] = useState('')

  useEffect(() => {
    setActiveTab((prev) => {
      const counts = {
        due: pendingReminders.length,
        upcoming: upcomingReminders.length,
        completed: completedReminders.length
      }
      if (counts[prev] > 0) return prev
      if (counts.due > 0) return 'due'
      if (counts.upcoming > 0) return 'upcoming'
      if (counts.completed > 0) return 'completed'
      return 'due'
    })
  }, [pendingReminders.length, upcomingReminders.length, completedReminders.length])

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

  const displayedReminders = useMemo(() => {
    const source = activeTab === 'due'
      ? pendingReminders
      : (activeTab === 'upcoming' ? upcomingReminders : completedReminders)

    const getTimeValue = (reminder) => {
      if (!reminder?.remindAt) return null
      const parsed = dayjs(reminder.remindAt)
      if (!parsed.isValid()) return null
      return parsed.valueOf()
    }

    const list = Array.isArray(source) ? source.slice() : []
    return list.sort((a, b) => {
      const aValue = getTimeValue(a)
      const bValue = getTimeValue(b)
      if (activeTab === 'completed') {
        return (bValue ?? Number.MIN_SAFE_INTEGER) - (aValue ?? Number.MIN_SAFE_INTEGER)
      }
      return (aValue ?? Number.MAX_SAFE_INTEGER) - (bValue ?? Number.MAX_SAFE_INTEGER)
    })
  }, [activeTab, pendingReminders, upcomingReminders, completedReminders])

  const remindersWithLabels = useMemo(() => displayedReminders.map((reminder) => {
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
  }), [displayedReminders])

  const tabCounts = {
    due: pendingReminders.length,
    upcoming: upcomingReminders.length,
    completed: completedReminders.length
  }

  const tabConfig = [
    { key: 'due', label: 'Due', count: tabCounts.due },
    { key: 'upcoming', label: 'Upcoming', count: tabCounts.upcoming },
    { key: 'completed', label: 'Completed', count: tabCounts.completed }
  ]

  const emptyMessages = {
    due: 'No due reminders.',
    upcoming: 'No upcoming reminders.',
    completed: 'No completed reminders.'
  }

  const bannerTitle = 'Reminders'
  const activeEmptyMessage = emptyMessages[activeTab] || 'No reminders to display.'

  if (!visible) return null
  if (pendingCount === 0 && !hasUpcoming && !hasCompleted) return null

  return (
    <div className="reminder-banner">
      <div className="reminder-banner-inner">
        <div className="reminder-banner-header">
          <strong>{bannerTitle}</strong>
          <div className="reminder-banner-tabs" role="tablist" aria-label="Reminder categories">
            {tabConfig.map(({ key, label, count }) => {
              const isActive = activeTab === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`reminder-tab ${isActive ? 'active' : ''}`}
                  role="tab"
                  aria-selected={isActive ? 'true' : 'false'}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(key)}
                >
                  {`${label} (${count})`}
                </button>
              )
            })}
          </div>
        </div>
        <div className="reminder-items">
          {remindersWithLabels.length === 0 ? (
            <div className="reminder-empty">{activeEmptyMessage}</div>
          ) : (
            remindersWithLabels.map(({ reminder, key, relativeLabel, absoluteLabel }) => (
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
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export const ReminderNotificationBar = memo(ReminderNotificationBarComponent)

