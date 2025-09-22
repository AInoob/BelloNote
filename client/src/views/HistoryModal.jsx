import React, { useEffect, useMemo, useRef, useState } from 'react'
import OutlinerView from './OutlinerView.jsx'
import { listHistory, getVersionDoc, diffVersion, restoreVersion } from '../api.js'

export default function HistoryModal({ onClose, onRestored }) {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // Custom confirm modal state
  const [confirming, setConfirming] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState('')
  const pendingRestoreIdRef = useRef(null)
  const [snapshotDoc, setSnapshotDoc] = useState(null)
  const [snapshotVersionId, setSnapshotVersionId] = useState(null)
  const [snapshotLoadingId, setSnapshotLoadingId] = useState(null)
  const [collapsedDays, setCollapsedDays] = useState(new Set())
  const snapshotRequestRef = useRef(0)

  useEffect(() => {
    (async () => {
      const rows = await listHistory(100, 0)
      setItems(rows)
      if (rows.length) select(rows[0])
    })()
  }, [])

  async function select(it) {
    setSelected(it)
    setLoading(true)
    try {
      const doc = await getVersionDoc(it.id)
      setPreview(doc.doc)
      const d = await diffVersion(it.id, 'current')
      setDiff(d)
    } finally {
      setLoading(false)
    }
  }

  async function doRestoreNow(versionId) {
    if (!versionId) return
    setRestoring(true)
    try {
      await restoreVersion(versionId)
      onRestored && onRestored()
    } finally {
      setRestoring(false)
    }
  }

  const grouped = useMemo(() => groupHistory(items), [items])
  const hasItems = grouped.length > 0
  const versionIndexMap = useMemo(() => {
    const map = new Map()
    items.forEach((it, index) => map.set(it.id, index))
    return map
  }, [items])
  const selectedIndex = useMemo(() => (selected ? versionIndexMap.get(selected.id) ?? -1 : -1), [selected, versionIndexMap])
  const totalVersions = items.length
  const snapshotIndex = snapshotVersionId != null ? (versionIndexMap.get(snapshotVersionId) ?? null) : null
  const isSnapshotLoading = snapshotLoadingId !== null
  const hasNewerSnapshot = snapshotIndex !== null && snapshotIndex > 0
  const hasOlderSnapshot = snapshotIndex !== null && snapshotIndex < totalVersions - 1

  useEffect(() => {
    setCollapsedDays(prev => {
      const next = new Set(prev)
      grouped.forEach((day, index) => {
        if (index === 0) {
          next.delete(day.key)
        } else if (!prev.has(day.key)) {
          next.add(day.key)
        }
      })
      return next
    })
  }, [grouped])

  const openSnapshotAtIndex = async (index, { reuseDoc = null } = {}) => {
    if (index == null || index < 0 || index >= items.length) return
    const target = items[index]
    if (!target) return
    const token = snapshotRequestRef.current + 1
    snapshotRequestRef.current = token
    if (reuseDoc) {
      setSnapshotVersionId(target.id)
      setSnapshotDoc(reuseDoc)
      setSnapshotLoadingId(null)
      return
    }
    setSnapshotLoadingId(target.id)
    try {
      const doc = await getVersionDoc(target.id)
      if (snapshotRequestRef.current !== token) return
      setSnapshotDoc(doc.doc)
      setSnapshotVersionId(target.id)
    } catch (err) {
      if (snapshotRequestRef.current === token) console.error('[history] snapshot load failed', err)
    } finally {
      if (snapshotRequestRef.current === token) setSnapshotLoadingId(null)
    }
  }

  const openSnapshot = (event, it) => {
    event.stopPropagation()
    const index = versionIndexMap.get(it.id)
    if (typeof index !== 'number') return
    const reuseDoc = selected?.id === it.id && preview ? preview : null
    openSnapshotAtIndex(index, { reuseDoc })
  }

  const closeSnapshot = () => {
    snapshotRequestRef.current += 1
    setSnapshotDoc(null)
    setSnapshotVersionId(null)
    setSnapshotLoadingId(null)
  }

  const handleSnapshotNewer = () => {
    if (!hasNewerSnapshot || snapshotIndex == null) return
    openSnapshotAtIndex(snapshotIndex - 1)
  }

  const handleSnapshotOlder = () => {
    if (!hasOlderSnapshot || snapshotIndex == null) return
    openSnapshotAtIndex(snapshotIndex + 1)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="left">
          <h2 style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <span style={{marginLeft:12}}>History</span>
            <button className="btn" style={{marginRight:12}} onClick={onClose}>Close</button>
          </h2>
          <div className="meta" style={{padding:'0 12px 12px', fontSize:'.85rem'}}>
            Autosave snapshots let you roll back mistakes. Manual checkpoints capture a named version instantly.
          </div>
          {!hasItems && !loading && (
            <div className="history-empty">
              <strong>No history yet.</strong>
              <div className="meta">Make some edits or create a checkpoint to see past versions here.</div>
            </div>
          )}
          {grouped.map(day => {
            const collapsed = collapsedDays.has(day.key)
            return (
              <div className={`history-day ${collapsed ? 'collapsed' : ''}`} key={day.key}>
                <button
                  type="button"
                  className="history-day-toggle"
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsedDays(prev => {
                    const next = new Set(prev)
                    if (next.has(day.key)) next.delete(day.key)
                    else next.add(day.key)
                    return next
                  })}
                >
                  <span className={`history-day-caret ${collapsed ? '' : 'open'}`} aria-hidden>▸</span>
                  <span className="history-day-label">{day.label}</span>
                  <span className="meta">{day.items.length} version{day.items.length === 1 ? '' : 's'}</span>
                </button>
                {!collapsed && (
                  <div className="history-day-list">
                    {day.items.map(it => (
                      <div
                        key={it.id}
                        className={`history-item ${selected?.id===it.id ? 'active' : ''}`}
                        onClick={() => select(it)}
                      >
                        <div>
                          <div>v{it.id} · {formatTime(it.created_at)}</div>
                          <div className="meta">{it.cause}{it.meta?.note ? ` · ${it.meta.note}` : ''}</div>
                        </div>
                        <div className="history-item-actions">
                          <div className="meta">{versionMetaText(it)}</div>
                          <button
                            className="btn ghost xs"
                            type="button"
                            onClick={(event) => openSnapshot(event, it)}
                            disabled={snapshotLoadingId === it.id}
                          >
                            {snapshotLoadingId === it.id ? 'Opening…' : 'Preview'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="right">
          {!selected ? <div className="meta">Select a version…</div> : null}
          {loading ? <div className="meta">Loading…</div> : null}
          {selected && !loading && (
            <>
              <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}>
                <div><strong>Version v{selected.id}</strong> · {new Date(selected.created_at + 'Z').toLocaleString()} · {selected.cause}</div>
                <div className="spacer"></div>
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (!preview || selectedIndex < 0) return
                    openSnapshotAtIndex(selectedIndex, { reuseDoc: preview })
                  }}
                  disabled={!preview}
                >
                  View snapshot
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (!selected) return
                    pendingRestoreIdRef.current = selected.id
                    setConfirmMessage('Restore this version? This will replace your current outline.')
                    setConfirming(true)
                  }}
                  disabled={restoring}
                >{restoring ? 'Restoring…' : 'Restore'}</button>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                <div>
                  <h3 style={{margin:'6px 0'}}>Diff vs current</h3>
                  {diff ? (
                    <div className="diff-list">
                      <div>+ added: {diff.summary.added}</div>
                      <div>- removed: {diff.summary.removed}</div>
                      <div>~ modified: {diff.summary.modified}</div>
                      <ul>
                        {diff.added.slice(0,20).map(x => <li key={'a'+x.id}>+ {x.title}</li>)}
                        {diff.removed.slice(0,20).map(x => <li key={'r'+x.id}>- {x.title}</li>)}
                        {diff.modified.slice(0,20).map(x => <li key={'m'+x.id}>~ {x.title}</li>)}
                      </ul>
                    </div>
                  ) : <div className="meta">No diff available.</div>}
                </div>
                <div>
                  <h3 style={{margin:'6px 0'}}>Preview</h3>
                  {preview ? (
                    <div className="history-inline-preview">
                      <OutlinerView
                        key={`inline-${selected?.id ?? 'preview'}`}
                        readOnly
                        initialOutline={preview}
                        showDebug={false}
                        onSaveStateChange={() => {}}
                      />
                    </div>
                  ) : <div className="meta">No preview</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {snapshotDoc && (
        <SnapshotViewer
          doc={snapshotDoc}
          onClose={closeSnapshot}
          onPrev={hasNewerSnapshot ? handleSnapshotNewer : null}
          onNext={hasOlderSnapshot ? handleSnapshotOlder : null}
          hasPrev={hasNewerSnapshot}
          hasNext={hasOlderSnapshot}
          isLoading={isSnapshotLoading}
          onRestore={async () => {
            if (!snapshotVersionId) return
            pendingRestoreIdRef.current = snapshotVersionId
            setConfirmMessage('Restore this version? This will replace your current outline.')
            setConfirming(true)
          }}
          restoring={restoring}
        />
      )}
      {confirming && (
        <div className="overlay" onClick={() => setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{marginTop:0}}>Confirm restore</h3>
            <div className="meta" style={{marginBottom:12}}>{confirmMessage || 'Are you sure?'}</div>
            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
              <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                className="btn"
                type="button"
                onClick={async () => { const id = pendingRestoreIdRef.current; setConfirming(false); await doRestoreNow(id) }}
                disabled={restoring}
              >{restoring ? 'Restoring…' : 'Restore'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function SnapshotViewer({ doc, onClose, onPrev, onNext, hasPrev = false, hasNext = false, isLoading = false, onRestore = null, restoring = false }) {
  if (!doc) return null
  const prevDisabled = !hasPrev || typeof onPrev !== 'function' || isLoading
  const nextDisabled = !hasNext || typeof onNext !== 'function' || isLoading
  return (
    <div className="snapshot-fullscreen" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="snapshot-fullscreen-inner" onClick={e => e.stopPropagation()}>
        <div className="snapshot-fullscreen-bar">
          <div className="snapshot-fullscreen-title">Snapshot preview</div>
          <div className="snapshot-fullscreen-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => { if (!prevDisabled) onPrev() }}
              disabled={prevDisabled}
            >
              Newer
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => { if (!nextDisabled) onNext() }}
              disabled={nextDisabled}
            >
              Older
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => { if (typeof onRestore === 'function' && !isLoading && !restoring) onRestore() }}
              disabled={isLoading || restoring}
            >
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
            <button className="btn" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="snapshot-fullscreen-body snapshot-fullscreen-body--outline">
          <OutlinerView
            readOnly
            initialOutline={doc}
            showDebug={false}
            onSaveStateChange={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

function groupHistory(rows) {
  const byDay = new Map()
  rows.forEach(row => {
    const date = parseTimestamp(row.created_at)
    if (!date) return
    const dayKey = date.toISOString().slice(0, 10)
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, {
        key: dayKey,
        label: formatDayLabel(date),
        items: []
      })
    }
    byDay.get(dayKey).items.push(row)
  })
  const groups = Array.from(byDay.values())
  groups.forEach(group => {
    group.items.sort((a, b) => {
      const da = parseTimestamp(a.created_at)
      const db = parseTimestamp(b.created_at)
      return (db?.getTime() || 0) - (da?.getTime() || 0)
    })
  })
  groups.sort((a, b) => (a.key > b.key ? -1 : (a.key < b.key ? 1 : 0)))
  return groups
}

function parseTimestamp(ts) {
  try {
    const date = new Date(ts + 'Z')
    return Number.isNaN(date.valueOf()) ? null : date
  } catch {
    return null
  }
}

function formatDayLabel(date) {
  const today = startOfDay(new Date())
  const target = startOfDay(date)
  const diffDays = Math.round((today.getTime() - target.getTime()) / DAY_MS)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  if (today.getFullYear() !== target.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString(undefined, opts)
}

function formatTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ts
}

function formatVersionTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

function versionMetaText(it) {
  const time = formatVersionTime(it.created_at)
  const size = formatSize(it.size_bytes)
  return [time, size].filter(Boolean).join(' · ')
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const DAY_MS = 24 * 60 * 60 * 1000
