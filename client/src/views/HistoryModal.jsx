import React, { useEffect, useMemo, useState } from 'react'
import { listHistory, getVersionDoc, diffVersion, restoreVersion } from '../api.js'

export default function HistoryModal({ onClose, onRestored }) {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [snapshotDoc, setSnapshotDoc] = useState(null)

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

  async function doRestore() {
    if (!selected) return
    if (!confirm('Restore this version? This will replace your current outline.')) return
    setRestoring(true)
    try {
      await restoreVersion(selected.id)
      onRestored && onRestored()
    } finally {
      setRestoring(false)
    }
  }

  const grouped = useMemo(() => groupHistory(items), [items])
  const hasItems = grouped.length > 0

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
          {grouped.map(day => (
            <div className="history-day" key={day.key}>
              <div className="history-day-label">{day.label}</div>
              {day.hours.map(hour => (
                <div className="history-hour" key={hour.key}>
                  <div className="history-hour-label">{hour.label}</div>
                  {hour.minutes.map(min => (
                    <div className="history-minute" key={min.key}>
                      <div className="history-minute-label">{min.label}</div>
                      {min.items.map(it => (
                        <div
                          key={it.id}
                          className={`history-item ${selected?.id===it.id ? 'active' : ''}`}
                          onClick={() => select(it)}
                        >
                          <div>
                            <div>v{it.id} · {formatTime(it.created_at)}</div>
                            <div className="meta">{it.cause} · {it.meta?.diffSummary ? `${it.meta.diffSummary.added} added · ${it.meta.diffSummary.removed} removed · ${it.meta.diffSummary.modified} modified` : 'no diff captured'}</div>
                          </div>
                          <div className="meta">{Math.round((it.size_bytes||0)/1024)} KB</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="right">
          {!selected ? <div className="meta">Select a version…</div> : null}
          {loading ? <div className="meta">Loading…</div> : null}
          {selected && !loading && (
            <>
              <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}>
                <div><strong>Version v{selected.id}</strong> · {new Date(selected.created_at + 'Z').toLocaleString()} · {selected.cause}</div>
                <div className="spacer"></div>
                <button className="btn ghost" onClick={() => preview && setSnapshotDoc(preview)} disabled={!preview}>View snapshot</button>
                <button className="btn" onClick={doRestore} disabled={restoring}>{restoring ? 'Restoring…' : 'Restore'}</button>
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
                  {preview ? <PreviewTree doc={preview} /> : <div className="meta">No preview</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {snapshotDoc && (
        <div className="overlay" onClick={() => setSnapshotDoc(null)}>
          <div className="modal" style={{ maxWidth:'70vw', maxHeight:'80vh' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:0 }}>
              <span>Snapshot preview</span>
              <button className="btn" onClick={() => setSnapshotDoc(null)}>Close</button>
            </h2>
            <div className="snapshot-tree">
              <PreviewTree doc={snapshotDoc} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewTree({ doc }) {
  return (
    <div className="tree">
      <ul>{(doc.roots||[]).map(node => <TreeNode key={node.id} node={node} />)}</ul>
    </div>
  )
}
function TreeNode({ node }) {
  return (
    <li>
      <span>{statusIcon(node.status)} {node.title} <span className="meta">{(node.ownWorkedOnDates||[]).map(d=>'@'+d).join(' ')}</span></span>
      {node.children && node.children.length ? (
        <ul>{node.children.map(ch => <TreeNode key={ch.id} node={ch} />)}</ul>
      ) : null}
    </li>
  )
}
function statusIcon(s) { return s==='done'?'✓':(s==='in-progress'?'◐':'○') }

function groupHistory(rows) {
  const dayMap = new Map()
  rows.forEach(row => {
    const date = new Date(row.created_at + 'Z')
    if (Number.isNaN(date.valueOf())) return
    const dayKey = date.toISOString().slice(0, 10)
    const hourKey = date.toISOString().slice(11, 13)
    const minuteKey = date.toISOString().slice(11, 16)
    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        key: dayKey,
        label: date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
        hours: new Map()
      })
    }
    const day = dayMap.get(dayKey)
    if (!day.hours.has(hourKey)) {
      day.hours.set(hourKey, {
        key: `${dayKey}-${hourKey}`,
        label: `${hourKey}:00`,
        minutes: new Map()
      })
    }
    const hour = day.hours.get(hourKey)
    if (!hour.minutes.has(minuteKey)) {
      hour.minutes.set(minuteKey, {
        key: `${dayKey}-${minuteKey}`,
        label: minuteKey,
        items: []
      })
    }
    hour.minutes.get(minuteKey).items.push(row)
  })
  return Array.from(dayMap.values()).map(day => ({
    ...day,
    hours: Array.from(day.hours.values()).map(hour => ({
      ...hour,
      minutes: Array.from(hour.minutes.values())
    }))
  }))
}

function formatTime(ts) {
  try {
    return new Date(ts + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ts
  }
}
