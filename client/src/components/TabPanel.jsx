import React from 'react'

/**
 * Tab panel component that shows/hides content based on active state
 * Keeps inactive panels in the DOM but hidden for state preservation
 *
 * @param {boolean} active - Whether this panel is currently active
 * @param {React.ReactNode} children - Panel content
 */
export function TabPanel({ active, children }) {
  if (!active) {
    return <div style={{ display: 'none' }}>{children}</div>
  }
  return <div style={{ display: 'block' }}>{children}</div>
}
