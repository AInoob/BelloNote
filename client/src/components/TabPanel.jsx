import React from 'react'

const VISIBLE_STYLE = { display: 'block' }
const HIDDEN_STYLE = { display: 'none' }

export function TabPanel({ active, children }) {
  return (
    <div style={active ? VISIBLE_STYLE : HIDDEN_STYLE}>
      {children}
    </div>
  )
}
