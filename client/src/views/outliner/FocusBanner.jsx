// ============================================================================
// Focus Banner Component
// Banner shown when in focus mode for a specific task
// ============================================================================

import React from 'react'

export function FocusBanner({ isVisible, title, onExit }) {
  if (!isVisible) return null

  const displayTitle = title?.trim() ? title.trim() : 'Untitled task'

  return (
    <div className="focus-banner">
      <div className="focus-banner-label">
        Viewing focus
        <span className="focus-banner-title">{displayTitle}</span>
      </div>
      <button className="btn ghost" type="button" onClick={onExit}>Exit focus</button>
    </div>
  )
}
