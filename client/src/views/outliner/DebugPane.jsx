// ============================================================================
// Debug Pane Component
// Development debug log display
// ============================================================================

import React from 'react'

export function DebugPane({ isVisible, debugLines }) {
  if (!isVisible) return null

  return (
    <div className="debug-pane">
      {debugLines.slice(-40).map((l, i) => <div className="debug-line" key={i}>{l}</div>)}
    </div>
  )
}
