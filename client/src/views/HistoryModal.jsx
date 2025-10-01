import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import OutlinerView from './OutlinerView.jsx'
import {
  listHistory,
  getVersionDoc,
  diffVersion,
  restoreVersion as restoreVersionApi
} from '../api.js'

const HISTORY_FETCH_LIMIT = 100
const RESTORE_CONFIRM_MESSAGE = 'Restore this version? This will replace your current outline.'

export default function HistoryModal({ onClose, onRestored }) {
  const history = useHistoryVersions(onRestored)
  const grouped = useMemo(() => groupHistory(history.items), [history.items])
  const { collapsedDays, toggleDay } = useCollapsedDays(grouped)
  const versionIndexMap = useMemo(() => buildVersionIndexMap(history.items), [history.items])

  const selectedIndex = useMemo(() => {
    if (!history.selected) return -1
    return versionIndexMap.get(history.selected.id) ?? -1
  }, [history.selected, versionIndexMap])

  const snapshot = useSnapshotManager({ items: history.items, versionIndexMap })
  const confirmRestore = useRestoreConfirmation(history.restoreVersion)

  const handleSelect = useCallback((version) => {
    history.selectVersion(version)
  }, [history])

  const handlePreview = useCallback((version) => {
    const reuseDoc = history.selected?.id === version.id && history.preview ? history.preview : null
    snapshot.openForVersion(version, reuseDoc)
  }, [history.preview, history.selected?.id, snapshot])

  const handleRestoreSelected = useCallback(() => {
    if (!history.selected) return
    confirmRestore.open(history.selected.id, RESTORE_CONFIRM_MESSAGE)
  }, [history.selected, confirmRestore])

  const handleSnapshotRestore = useCallback(() => {
    if (!snapshot.snapshotVersionId) return
    const versionId = snapshot.snapshotVersionId
    snapshot.close()
    confirmRestore.open(versionId, RESTORE_CONFIRM_MESSAGE)
  }, [snapshot, confirmRestore])

  return (
    <div className="overlay" style={{ zIndex: 900 }} onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <HistorySidebar
          grouped={grouped}
          collapsedDays={collapsedDays}
          onToggleDay={toggleDay}
          selected={history.selected}
          onSelectVersion={handleSelect}
          onPreviewVersion={handlePreview}
          snapshotLoadingId={snapshot.loadingVersionId}
          hasItems={grouped.length > 0}
          loading={history.loading}
          onClose={onClose}
        />
        <HistoryDetails
          selected={history.selected}
          loading={history.loading}
          preview={history.preview}
          diff={history.diff}
          selectedIndex={selectedIndex}
          onViewSnapshot={(reuseDoc) => {
            if (selectedIndex < 0) return
            snapshot.openAtIndex(selectedIndex, { reuseDoc })
          }}
          restoring={history.restoring}
          onRequestRestore={handleRestoreSelected}
        />
      </div>
      {snapshot.snapshotDoc && !confirmRestore.visible && (
        <SnapshotViewer
          doc={snapshot.snapshotDoc}
          onClose={snapshot.close}
          onPrev={snapshot.hasNewer ? snapshot.viewNewer : null}
          onNext={snapshot.hasOlder ? snapshot.viewOlder : null}
          hasPrev={snapshot.hasNewer}
          hasNext={snapshot.hasOlder}
          isLoading={snapshot.isLoading}
          onRestore={handleSnapshotRestore}
          restoring={history.restoring}
          isDimmed={confirmRestore.visible}
        />
      )}
      {confirmRestore.visible && (
        <ConfirmRestoreDialog
          message={confirmRestore.message}
          restoring={history.restoring}
          onCancel={confirmRestore.close}
          onConfirm={confirmRestore.confirm}
        />
      )}
    </div>
  )
}

function HistorySidebar({
  grouped,
  collapsedDays,
  onToggleDay,
  selected,
  onSelectVersion,
  onPreviewVersion,
  snapshotLoadingId,
  hasItems,
  loading,
  onClose
}) {
  return (
    <div className="left">
      <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ marginLeft: 12 }}>History</span>
        <button className="btn" style={{ marginRight: 12 }} onClick={onClose}>Close</button>
      </h2>
      <div className="meta" style={{ padding: '0 12px 12px', fontSize: '.85rem' }}>
        Autosave snapshots let you roll back mistakes. Manual checkpoints capture a named version instantly.
      </div>
      {!hasItems && !loading && (
        <div className="history-empty">
          <strong>No history yet.</strong>
          <div className="meta">Make some edits or create a checkpoint to see past versions here.</div>
        </div>
      )}
      {grouped.map((day) => (
        <HistoryDay
          key={day.key}
          day={day}
          collapsed={collapsedDays.has(day.key)}
          onToggle={() => onToggleDay(day.key)}
          selectedId={selected?.id ?? null}
          onSelectVersion={onSelectVersion}
          onPreviewVersion={onPreviewVersion}
          snapshotLoadingId={snapshotLoadingId}
        />
      ))}
    </div>
  )
}

function HistoryDay({
  day,
  collapsed,
  onToggle,
  selectedId,
  onSelectVersion,
  onPreviewVersion,
  snapshotLoadingId
}) {
  return (
    <div className={`history-day ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="history-day-toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className={`history-day-caret ${collapsed ? '' : 'open'}`} aria-hidden>▸</span>
        <span className="history-day-label">{day.label}</span>
        <span className="meta">{day.items.length} version{day.items.length === 1 ? '' : 's'}</span>
      </button>
      {!collapsed && (
        <div className="history-day-list">
          {day.items.map((version) => {
            const isSelected = selectedId === version.id
            const loading = snapshotLoadingId === version.id
            return (
              <div
                key={version.id}
                className={`history-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectVersion(version)}
              >
                <div>
                  <div>v{version.id} · {formatTime(version.created_at)}</div>
                  <div className="meta">{version.cause}{version.meta?.note ? ` · ${version.meta.note}` : ''}</div>
                </div>
                <div className="history-item-actions">
                  <div className="meta">{versionMetaText(version)}</div>
                  <button
                    className="btn ghost xs"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPreviewVersion(version)
                    }}
                    disabled={loading}
                  >
                    {loading ? 'Opening…' : 'Preview'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function HistoryDetails({
  selected,
  loading,
  preview,
  diff,
  selectedIndex,
  onViewSnapshot,
  restoring,
  onRequestRestore
}) {
  if (!selected) {
    return (
      <div className="right">
        <div className="meta">Select a version…</div>
      </div>
    )
  }

  return (
    <div className="right">
      {loading && <div className="meta">Loading…</div>}
      {!loading && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div><strong>Version v{selected.id}</strong> · {new Date(`${selected.created_at}Z`).toLocaleString()} · {selected.cause}</div>
            <div className="spacer" />
            <button
              className="btn ghost"
              onClick={() => onViewSnapshot(preview)}
              disabled={!preview || selectedIndex < 0}
            >
              View snapshot
            </button>
            <button className="btn" onClick={onRequestRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Restore'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <h3 style={{ margin: '6px 0' }}>Diff vs current</h3>
              {diff ? <DiffSummary diff={diff} /> : <div className="meta">No diff available.</div>}
            </div>
            <div>
              <h3 style={{ margin: '6px 0' }}>Preview</h3>
              {preview ? (
                <div className="history-inline-preview">
                  <OutlinerView
                    key={`inline-${selected.id}`}
                    readOnly
                    initialOutline={preview}
                    showDebug={false}
                    broadcastSnapshots={false}
                    onSaveStateChange={() => {}}
                  />
                </div>
              ) : <div className="meta">No preview</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DiffSummary({ diff }) {
  return (
    <div className="diff-list">
      <div>+ added: {diff.summary.added}</div>
      <div>- removed: {diff.summary.removed}</div>
      <div>~ modified: {diff.summary.modified}</div>
      <ul>
        {diff.added.slice(0, 20).map((item) => <li key={`a${item.id}`}>+ {item.title}</li>)}
        {diff.removed.slice(0, 20).map((item) => <li key={`r${item.id}`}>- {item.title}</li>)}
        {diff.modified.slice(0, 20).map((item) => <li key={`m${item.id}`}>~ {item.title}</li>)}
      </ul>
    </div>
  )
}

function ConfirmRestoreDialog({ message, restoring, onCancel, onConfirm }) {
  return (
    <div
      className="overlay"
      style={{ zIndex: 99999, position: 'fixed', inset: 0, pointerEvents: 'auto' }}
      onClick={onCancel}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Confirm restore</h3>
        <div className="meta" style={{ marginBottom: 12 }}>{message || 'Are you sure?'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn" type="button" onClick={onConfirm} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SnapshotViewer({
  doc,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  isLoading = false,
  onRestore = null,
  restoring = false,
  isDimmed = false
}) {
  if (!doc) return null
  const prevDisabled = !hasPrev || typeof onPrev !== 'function' || isLoading
  const nextDisabled = !hasNext || typeof onNext !== 'function' || isLoading

  return (
    <div
      className="snapshot-fullscreen"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ zIndex: 1000, position: 'fixed', inset: 0, pointerEvents: isDimmed ? 'none' : 'auto' }}
    >
      <div className="snapshot-fullscreen-inner" onClick={(event) => event.stopPropagation()}>
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
            broadcastSnapshots={false}
            onSaveStateChange={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

function useHistoryVersions(onRestored) {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const selectVersion = useCallback(async (version) => {
    if (!version) return
    setSelected(version)
    setLoading(true)
    try {
      const doc = await getVersionDoc(version.id)
      setPreview(doc.doc)
      const diffResult = await diffVersion(version.id, 'current')
      setDiff(diffResult)
    } finally {
      setLoading(false)
    }
  }, [])

  const restoreVersion = useCallback(async (versionId) => {
    if (!versionId) return
    setRestoring(true)
    try {
      await restoreVersionApi(versionId)
      if (typeof onRestored === 'function') {
        onRestored()
      }
    } finally {
      setRestoring(false)
    }
  }, [onRestored])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await listHistory(HISTORY_FETCH_LIMIT, 0)
      if (cancelled) return
      setItems(rows)
      if (rows.length) {
        selectVersion(rows[0])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectVersion])

  return {
    items,
    selected,
    preview,
    diff,
    loading,
    restoring,
    selectVersion,
    restoreVersion
  }
}

function useSnapshotManager({ items, versionIndexMap }) {
  const [snapshotDoc, setSnapshotDoc] = useState(null)
  const [snapshotVersionId, setSnapshotVersionId] = useState(null)
  const [loadingVersionId, setLoadingVersionId] = useState(null)
  const requestRef = useRef(0)

  const openAtIndex = useCallback(async (index, { reuseDoc = null } = {}) => {
    if (index == null || index < 0 || index >= items.length) return
    const target = items[index]
    if (!target) return
    const token = requestRef.current + 1
    requestRef.current = token

    if (reuseDoc) {
      setSnapshotVersionId(target.id)
      setSnapshotDoc(reuseDoc)
      setLoadingVersionId(null)
      return
    }

    setLoadingVersionId(target.id)
    try {
      const doc = await getVersionDoc(target.id)
      if (requestRef.current !== token) return
      setSnapshotDoc(doc.doc)
      setSnapshotVersionId(target.id)
    } catch (error) {
      if (requestRef.current === token) {
        console.error('[history] snapshot load failed', error)
      }
    } finally {
      if (requestRef.current === token) {
        setLoadingVersionId(null)
      }
    }
  }, [items])

  const openForVersion = useCallback((version, reuseDoc = null) => {
    if (!version) return
    const index = versionIndexMap.get(version.id)
    if (typeof index !== 'number') return
    openAtIndex(index, { reuseDoc })
  }, [openAtIndex, versionIndexMap])

  const close = useCallback(() => {
    requestRef.current += 1
    setSnapshotDoc(null)
    setSnapshotVersionId(null)
    setLoadingVersionId(null)
  }, [])

  const snapshotIndex = useMemo(() => {
    if (snapshotVersionId == null) return null
    return versionIndexMap.get(snapshotVersionId) ?? null
  }, [snapshotVersionId, versionIndexMap])

  const hasNewer = snapshotIndex !== null && snapshotIndex > 0
  const hasOlder = snapshotIndex !== null && snapshotIndex < items.length - 1

  const viewNewer = useCallback(() => {
    if (!hasNewer || snapshotIndex == null) return
    openAtIndex(snapshotIndex - 1)
  }, [hasNewer, snapshotIndex, openAtIndex])

  const viewOlder = useCallback(() => {
    if (!hasOlder || snapshotIndex == null) return
    openAtIndex(snapshotIndex + 1)
  }, [hasOlder, snapshotIndex, openAtIndex])

  return {
    snapshotDoc,
    snapshotVersionId,
    loadingVersionId,
    isLoading: loadingVersionId !== null,
    hasNewer,
    hasOlder,
    openAtIndex,
    openForVersion,
    close,
    viewNewer,
    viewOlder
  }
}

function useRestoreConfirmation(onRestore) {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const pendingVersionRef = useRef(null)

  const open = useCallback((versionId, confirmMessage) => {
    pendingVersionRef.current = versionId
    setMessage(confirmMessage || '')
    setVisible(true)
  }, [])

  const close = useCallback(() => {
    pendingVersionRef.current = null
    setVisible(false)
  }, [])

  const confirm = useCallback(async () => {
    const versionId = pendingVersionRef.current
    pendingVersionRef.current = null
    setVisible(false)
    if (!versionId) return
    await onRestore(versionId)
  }, [onRestore])

  return { visible, message, open, close, confirm }
}

function useCollapsedDays(groupedDays) {
  const [collapsedDays, setCollapsedDays] = useState(new Set())

  useEffect(() => {
    setCollapsedDays((previous) => {
      const next = new Set(previous)
      groupedDays.forEach((day, index) => {
        if (index === 0) {
          next.delete(day.key)
        } else if (!previous.has(day.key)) {
          next.add(day.key)
        }
      })
      return next
    })
  }, [groupedDays])

  const toggleDay = useCallback((dayKey) => {
    setCollapsedDays((previous) => {
      const next = new Set(previous)
      if (next.has(dayKey)) next.delete(dayKey)
      else next.add(dayKey)
      return next
    })
  }, [])

  return { collapsedDays, toggleDay }
}

function buildVersionIndexMap(items) {
  const map = new Map()
  items.forEach((item, index) => {
    map.set(item.id, index)
  })
  return map
}

function groupHistory(rows) {
  const byDay = new Map()
  rows.forEach((row) => {
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
  groups.forEach((group) => {
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
    const date = new Date(`${ts}Z`)
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

function versionMetaText(version) {
  const time = formatVersionTime(version.created_at)
  const size = formatSize(version.size_bytes)
  return [time, size].filter(Boolean).join(' · ')
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const DAY_MS = 24 * 60 * 60 * 1000
