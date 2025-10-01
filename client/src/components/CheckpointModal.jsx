// ============================================================================
// Checkpoint Modal Component
// Modal dialog for saving named snapshots/checkpoints
// ============================================================================

import React from 'react'

/**
 * CheckpointModal Component
 * Displays a modal for creating named checkpoints with optional notes
 * @param {Object} props - Component props
 * @param {string} props.note - Current note text
 * @param {Function} props.onChange - Handler for note text changes
 * @param {Object} props.status - Status object with state and message
 * @param {Function} props.onSubmit - Handler for form submission
 * @param {Function} props.onClose - Handler for closing the modal
 * @param {Function} props.onViewHistory - Handler for opening history panel
 */
export function CheckpointModal({ note, onChange, status, onSubmit, onClose, onViewHistory }) {
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <h2 style={{ marginTop: 0 }}>Save checkpoint</h2>
        <p className="meta" style={{ marginTop: -4, marginBottom: 16 }}>
          Adds a named snapshot you can restore from the History panel.
        </p>
        <label className="meta" style={{ display: 'block', marginBottom: 6 }}>Optional note</label>
        <textarea
          value={note}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder="What changed?"
          style={{
            width: '100%',
            resize: 'vertical',
            padding: 8,
            borderRadius: 8,
            border: '1px solid var(--border)',
            fontFamily: 'inherit'
          }}
        />
        {status.message && (
          <div
            className={`meta ${status.state === 'error' ? 'error' : ''}`}
            style={{ marginTop: 8 }}
          >
            {status.message}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {status.state === 'success' && (
            <button type="button" className="btn" onClick={onViewHistory}>
              Open history
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={status.state === 'saving'}>
            {status.state === 'saving' ? 'Saving…' : 'Save checkpoint'}
          </button>
        </div>
      </form>
    </div>
  )
}
