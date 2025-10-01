// ============================================================================
// Date Picker Component
// Simple date picker for inserting date tokens via slash command
// ============================================================================

import React from 'react'

export function DatePicker({ isOpen, slashPos, datePickerValueRef, applyPickedDate, onClose }) {
  if (!isOpen) return null

  return (
    <div className="date-picker-pop" style={{ left: slashPos.x, top: slashPos.y }} role="dialog" aria-modal="true">
      <div className="date-picker-title">Pick a date</div>
      <input
        type="date"
        defaultValue={datePickerValueRef.current}
        onChange={(e) => { datePickerValueRef.current = e.target.value }}
      />
      <div className="date-picker-actions">
        <button className="btn" type="button" onClick={applyPickedDate}>Insert</button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
