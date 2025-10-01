// ============================================================================
// Snapshot Viewer Component
// Full-screen preview of a historical document version
// ============================================================================

import React from 'react'
import OutlinerView from '../OutlinerView.jsx'

/**
 * SnapshotViewer Component
 * Renders a full-screen modal showing a historical document snapshot
 * @param {Object} props - Component props
 * @param {Object} props.doc - Document to display
 * @param {Function} props.onClose - Handler for closing the viewer
 * @param {Function} [props.onPrev] - Handler for navigating to newer snapshot
 * @param {Function} [props.onNext] - Handler for navigating to older snapshot
 * @param {boolean} [props.hasPrev=false] - Whether a newer snapshot exists
 * @param {boolean} [props.hasNext=false] - Whether an older snapshot exists
 * @param {boolean} [props.isLoading=false] - Whether snapshot is loading
 * @param {Function|null} [props.onRestore=null] - Handler for restoring this snapshot
 * @param {boolean} [props.restoring=false] - Whether restore operation is in progress
 * @param {boolean} [props.isDimmed=false] - Whether to dim the viewer (during confirmation)
 */
export function SnapshotViewer({
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
            broadcastSnapshots={false}
            onSaveStateChange={() => {}}
          />
        </div>
      </div>
    </div>
  )
}
