import React from 'react'

/**
 * TabPanel component that shows/hides content based on active state
 * @param {Object} props - Component props
 * @param {boolean} props.active - Whether this tab panel is active
 * @param {React.ReactNode} props.children - Panel content
 * @returns {JSX.Element} The tab panel element
 */
export function TabPanel({ active, children }) {
  const style = { display: active ? 'block' : 'none' }
  return <div style={style}>{children}</div>
}
