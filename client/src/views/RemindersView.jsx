import React, { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { describeTimeUntil, useReminders } from '../context/ReminderContext.jsx'

const SECTIONS = ['due', 'upcoming', 'completed', 'dismissed']

const SECTION_LABELS = {
  due: 'Due now',
  upcoming: 'Scheduled',
  completed: 'Completed',
  dismissed: 'Dismissed'
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = dayjs(value)
  if (!d.isValid()) return '—'
  return d.format('MMM D, YYYY h:mm A')
}

export default function RemindersView() {
  const { reminders, pendingReminders, dismissReminder, completeReminder, removeReminder } = useReminders()
  const [activeSection, setActiveSection] = useState('due')

  const categorized = useMemo(() => {
    const dueIds = new Set(pendingReminders.map(r => r.id))
    const groups = {
      due: [],
      upcoming: [],
      completed: [],
      dismissed: []
    }
    reminders.forEach(reminder => {
      if (reminder.status === 'completed') {
        groups.completed.push(reminder)
      } else if (reminder.status === 'dismissed') {
        groups.dismissed.push(reminder)
      } else if (reminder.status === 'scheduled') {
        if (dueIds.has(reminder.id) || reminder.due) groups.due.push(reminder)
        else groups.upcoming.push(reminder)
      }
    })
    return groups
  }, [pendingReminders, reminders])

  const current = categorized[activeSection] || []

  return (
    <section className="reminders-view">
      <header className="reminders-header">
        <h2>Reminders</h2>
        <nav className="reminders-tabs">
          {SECTIONS.map(section => (
            <button
              key={section}
              className={`btn pill ${activeSection === section ? 'active' : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {SECTION_LABELS[section]}
              <span className="tab-count">{categorized[section]?.length || 0}</span>
            </button>
          ))}
        </nav>
      </header>

      {current.length === 0 ? (
        <div className="reminder-empty">No reminders in this section.</div>
      ) : (
        <div className="reminder-list">
          {current.map(reminder => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              onComplete={() => completeReminder(reminder.id)}
              onDismiss={() => dismissReminder(reminder.id)}
              onRemove={() => removeReminder(reminder.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ReminderCard({ reminder, onComplete, onDismiss, onRemove }) {
  const isDue = reminder.status === 'scheduled' && (reminder.due || dayjs(reminder.remindAt).isBefore(dayjs()))
  const statusLabel = reminder.status === 'scheduled'
    ? (isDue ? 'Due' : 'Scheduled')
    : reminder.status === 'completed'
      ? 'Completed'
      : 'Dismissed'

  return (
    <article className={`reminder-card ${isDue ? 'due' : reminder.status}`}>
      <header className="reminder-card-header">
        <span className="reminder-card-title">{reminder.taskTitle || `Task #${reminder.taskId}`}</span>
        <span className="reminder-card-status">{statusLabel}</span>
      </header>
      <div className="reminder-card-body">
        <div className="reminder-card-row">
          <span className="label">Remind at</span>
          <span>{formatDateTime(reminder.remindAt)}</span>
        </div>
        <div className="reminder-card-row">
          <span className="label">Relative</span>
          <span>{describeTimeUntil(reminder)}</span>
        </div>
      </div>
      <footer className="reminder-card-actions">
        {reminder.status === 'scheduled' && (
          <>
            <button className="btn small" onClick={onComplete}>Mark complete</button>
            <button className="btn small ghost" onClick={onDismiss}>{isDue ? 'Dismiss' : 'Snooze off'}</button>
          </>
        )}
        <button className="btn small ghost" onClick={onRemove}>Remove</button>
      </footer>
    </article>
  )
}
