import React from 'react'

export function TabPanel({ active, children }) {
  if (!active) {
    return <div style={{ display: 'none' }}>{children}</div>
  }
  return <div style={{ display: 'block' }}>{children}</div>
}
