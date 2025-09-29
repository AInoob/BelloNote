import React from 'react'

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
