
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OutlinerView from './views/OutlinerView.jsx'
import TimelineView from './views/TimelineView.jsx'
import HistoryModal from './views/HistoryModal.jsx'
import { createCheckpoint, getHealth } from './api.js'
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
        <div className="spacer" />
        <button className="btn" onClick={openCheckpoint}>Checkpoint</button>
        <button className="btn" onClick={() => setShowHistory(true)}>History</button>
        <button className="btn" onClick={() => { const v=!showDebug; setShowDebug(v); localStorage.setItem('WL_DEBUG', v?'1':'0') }}>{showDebug?'Hide':'Show'} Debug</button>
        <div className="save-indicator">{statusText}</div>
      </header>
      <main>
        {tab === 'outline'
          ? <OutlinerView onSaveStateChange={setSaveState} showDebug={showDebug} />
          : <TimelineView />}
      </main>
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

createRoot(document.getElementById('root')).render(<App />)
