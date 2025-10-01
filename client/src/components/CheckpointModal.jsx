import React, { useCallback } from 'react'

const MODAL_STYLE = { maxWidth: 420 }
const NOTE_LABEL_STYLE = { display: 'block', marginBottom: 6 }
const TEXTAREA_STYLE = {
  width: '100%',
  resize: 'vertical',
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontFamily: 'inherit'
}
const STATUS_STYLE = { marginTop: 8 }
const FOOTER_STYLE = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }
const SUBTITLE_STYLE = { marginTop: -4, marginBottom: 16 }

export function CheckpointModal({ note, onChange, status, onSubmit, onClose, onViewHistory }) {
  const handleModalClick = useCallback((event) => {
    event.stopPropagation()
  }, [])

  const handleNoteChange = useCallback((event) => {
    onChange(event.target.value)
  }, [onChange])

  const showHistoryButton = status.state === 'success'
  const isSaving = status.state === 'saving'

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" style={MODAL_STYLE} onClick={handleModalClick} onSubmit={onSubmit}>
        <h2 style={{ marginTop: 0 }}>Save checkpoint</h2>
        <p className="meta" style={SUBTITLE_STYLE}>
          Adds a named snapshot you can restore from the History panel.
        </p>
        <label className="meta" style={NOTE_LABEL_STYLE}>Optional note</label>
        <textarea
          value={note}
          onChange={handleNoteChange}
          rows={3}
          placeholder="What changed?"
          style={TEXTAREA_STYLE}
        />
        {status.message && (
          <div className={`meta ${status.state === 'error' ? 'error' : ''}`} style={STATUS_STYLE}>
            {status.message}
          </div>
        )}
        <div style={FOOTER_STYLE}>
          {showHistoryButton && (
            <button type="button" className="btn" onClick={onViewHistory}>
              Open history
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save checkpoint'}
          </button>
        </div>
      </form>
    </div>
  )
}
