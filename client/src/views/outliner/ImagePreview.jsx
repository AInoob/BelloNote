// ============================================================================
// Image Preview Component
// Modal for viewing images in full size
// ============================================================================

import React from 'react'

export function ImagePreview({ src, onClose }) {
  if (!src) return null

  return (
    <div className="overlay" onClick={onClose}>
      <div className="image-modal" onClick={e => e.stopPropagation()}>
        <img src={src} alt="Preview" />
        <button className="btn" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
