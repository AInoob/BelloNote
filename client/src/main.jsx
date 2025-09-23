
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OutlinerView from './views/OutlinerView.jsx'
import TimelineView from './views/TimelineView.jsx'
import RemindersView from './views/RemindersView.jsx'
import HistoryModal from './views/HistoryModal.jsx'
import { createCheckpoint, getHealth } from './api.js'
import { ReminderProvider, useReminders } from './context/ReminderContext.jsx'
import dayjs from 'dayjs'
const CLIENT_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null

function App() {
  const [tab, setTab] = useState('outline')
  const [saveState, setSaveState] = useState({ dirty:false, saving:false })
  const [showHistory, setShowHistory] = useState(false)
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [checkpointNote, setCheckpointNote] = useState('')
  const [checkpointStatus, setCheckpointStatus] = useState({ state: 'idle', message: '' })
  const [showDebug, setShowDebug] = useState(() => {
    const stored = localStorage.getItem('WL_DEBUG')
    if (stored === null) {
      localStorage.setItem('WL_DEBUG', '1')
      return true
    }
    return stored === '1'
  })
  const [serverBuildTime, setServerBuildTime] = useState(null)
  const [healthFetchedAt, setHealthFetchedAt] = useState(null)

  const { pendingReminders } = useReminders()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getHealth()
        if (!cancelled) {
          setServerBuildTime(data?.buildTime || null)
          setHealthFetchedAt(new Date())
        }
      } catch (e) {
        if (!cancelled) {
          setServerBuildTime(null)
          setHealthFetchedAt(new Date())
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const formatStamp = (stamp) => {
    if (!stamp) return 'unknown'
    const date = typeof stamp === 'string' ? new Date(stamp) : stamp
    return Number.isNaN(date.valueOf()) ? String(stamp) : date.toLocaleString()
  }

  const openCheckpoint = () => {
    setCheckpointNote('')
    setCheckpointStatus({ state: 'idle', message: '' })
    setCheckpointOpen(true)
  }

  const submitCheckpoint = async (e) => {
    e.preventDefault()
    if (checkpointStatus.state === 'saving') return
    setCheckpointStatus({ state: 'saving', message: '' })
    try {
      await createCheckpoint(checkpointNote.trim())
      setCheckpointStatus({ state: 'success', message: 'Checkpoint saved!' })
    } catch (err) {
      setCheckpointStatus({ state: 'error', message: err?.message || 'Failed to save checkpoint' })
    }
  }

  const statusText = saveState.saving ? 'Saving…' : (saveState.dirty ? 'Unsaved changes' : 'Saved')
  return (
    <>
      <div className="topbar">
        <div className="version-banner">
          <span>Client built {formatStamp(CLIENT_BUILD_TIME)}</span>
          <span>Server built {formatStamp(serverBuildTime)}</span>
          {healthFetchedAt && <span>Checked {formatStamp(healthFetchedAt)}</span>}
        </div>
        <header>
          <h1>Daily Worklog</h1>
          <div className="spacer" />
          <button className={`btn ${tab==='outline' ? 'active' : ''}`} onClick={() => setTab('outline')}>Outline</button>
          <button className={`btn ${tab==='timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}>Timeline</button>
          <button className={`btn ${tab==='reminders' ? 'active' : ''}`} onClick={() => setTab('reminders')}>Reminders</button>
          <div className="spacer" />
          <button className="btn" onClick={openCheckpoint}>Checkpoint</button>
          <button className="btn" onClick={() => setShowHistory(true)}>History</button>
          <button className="btn" onClick={() => { const v=!showDebug; setShowDebug(v); localStorage.setItem('WL_DEBUG', v?'1':'0') }}>{showDebug?'Hide':'Show'} Debug</button>
          <div className="save-indicator">{statusText}</div>
        </header>
      </div>
      <main>
        {tab === 'outline' && <OutlinerView onSaveStateChange={setSaveState} showDebug={showDebug} />}
        {tab === 'timeline' && <TimelineView />}
        {tab === 'reminders' && <RemindersView />}
      </main>
      <ReminderNotificationBar visible={pendingReminders.length > 0} />
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onRestored={() => window.location.reload()} />}
      {checkpointOpen && (
        <CheckpointModal
          note={checkpointNote}
          onChange={setCheckpointNote}
          status={checkpointStatus}
          onSubmit={submitCheckpoint}
          onClose={() => setCheckpointOpen(false)}
          onViewHistory={() => { setCheckpointOpen(false); setShowHistory(true) }}
        />
      )}
    </>
  )
}

function CheckpointModal({ note, onChange, status, onSubmit, onClose, onViewHistory }) {
  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 style={{ marginTop: 0 }}>Save checkpoint</h2>
        <p className="meta" style={{ marginTop: -4, marginBottom: 16 }}>
          Adds a named snapshot you can restore from the History panel.
        </p>
        <label className="meta" style={{ display:'block', marginBottom:6 }}>Optional note</label>
        <textarea
          value={note}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder="What changed?"
          style={{ width:'100%', resize:'vertical', padding:8, borderRadius:8, border:'1px solid var(--border)', fontFamily:'inherit' }}
        />
        {status.message && (
          <div className={`meta ${status.state === 'error' ? 'error' : ''}`} style={{ marginTop:8 }}>
            {status.message}
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:16 }}>
          {status.state === 'success' && (
            <button type="button" className="btn" onClick={onViewHistory}>Open history</button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={status.state === 'saving'}>
            {status.state === 'saving' ? 'Saving…' : 'Save checkpoint'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ReminderNotificationBar({ visible }) {
  const { pendingReminders, dismissReminder, completeReminder, scheduleReminder } = useReminders()
  const [customEditingId, setCustomEditingId] = useState(null)
  const [customDate, setCustomDate] = useState('')
  const [customError, setCustomError] = useState('')

  const defaultCustomDate = (reminder) => {
    const base = reminder?.due || reminder?.remindAt
    const fallback = dayjs().add(1, 'hour')
    const source = base ? dayjs(base) : fallback
    const value = source?.isValid() ? source : fallback
    return value.startOf('minute').format('YYYY-MM-DDTHH:mm')
  }

  const openCustom = (reminder) => {
    setCustomEditingId(reminder.id)
    setCustomDate(defaultCustomDate(reminder))
    setCustomError('')
  }

  const handleCustomSubmit = async (event, reminder) => {
    event.preventDefault()
    if (!reminder?.taskId) return
    if (!customDate) {
      setCustomError('Pick a date and time')
      return
    }
    const parsed = dayjs(customDate)
    if (!parsed.isValid()) {
      setCustomError('Pick a valid date and time')
      return
    }
    try {
      await scheduleReminder({ taskId: reminder.taskId, remindAt: parsed.toISOString(), message: reminder.message || undefined })
      setCustomEditingId(null)
      setCustomError('')
    } catch (err) {
      console.error('[reminders] failed to schedule custom date', err)
      setCustomError(err?.message || 'Unable to update reminder')
    }
  }

  const reschedule = async (reminder, minutes) => {
    if (!reminder?.taskId) return
    try {
      const remindAt = dayjs().add(minutes, 'minute').toISOString()
      await scheduleReminder({ taskId: reminder.taskId, remindAt, message: reminder.message || undefined })
      if (customEditingId === reminder.id) {
        setCustomEditingId(null)
        setCustomError('')
      }
    } catch (err) {
      console.error('[reminders] failed to reschedule', err)
    }
  }
  if (!visible) return null
  return (
    <div className="reminder-banner">
      <div className="reminder-banner-inner">
        <strong>{pendingReminders.length === 1 ? 'Reminder due' : `${pendingReminders.length} reminders due`}</strong>
        <div className="reminder-items">
          {pendingReminders.map(reminder => (
            <div key={reminder.id} className="reminder-item">
              <span className="reminder-title">{reminder.taskTitle || `Task #${reminder.taskId}`}</span>
              <span className="reminder-meta">{new Date(reminder.remindAt).toLocaleString()}</span>
              <div className="reminder-actions">
                <div className="reminder-snooze" aria-label="Reschedule reminder">
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 10)}>+10m</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 30)}>+30m</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 60)}>+1h</button>
                  <button className="btn small ghost" onClick={() => reschedule(reminder, 120)}>+2h</button>
                </div>
                <button className="btn small ghost" onClick={() => openCustom(reminder)}>Custom…</button>
                {customEditingId === reminder.id && (
                  <form className="reminder-custom" onSubmit={(event) => handleCustomSubmit(event, reminder)}>
                    <input
                      type="datetime-local"
                      value={customDate}
                      onChange={(e) => {
                        setCustomDate(e.target.value)
                        if (customError) setCustomError('')
                      }}
                      required
                    />
                    <button type="submit" className="btn small">Set</button>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        setCustomEditingId(null)
                        setCustomError('')
                      }}
                    >
                      Cancel
                    </button>
                    {customError && <span className="reminder-custom-error">{customError}</span>}
                  </form>
                )}
                <button className="btn small" onClick={() => completeReminder(reminder.id)}>Mark complete</button>
                <button className="btn small ghost" onClick={() => dismissReminder(reminder.id)}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Root() {
  return (
    <ReminderProvider>
      <App />
    </ReminderProvider>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
