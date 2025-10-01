// ============================================================================
// Top Bar Component
// Application header with tabs, actions, and build info
// ============================================================================

import React from 'react'
import { formatTimestamp } from '../utils/formatTimestamp.js'

/** Available tabs for the application */
const TABS = [
  { id: 'outline', label: 'Outline' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'reminders', label: 'Reminders' }
]

/**
 * TopBar Component
 * Displays application header with tabs, actions, and version info
 * @param {Object} props - Component props
 * @param {string} props.activeTab - Currently active tab ID
 * @param {Function} props.onSelectTab - Handler for tab selection
 * @param {Function} props.onOpenCheckpoint - Handler for opening checkpoint modal
 * @param {Function} props.onShowHistory - Handler for opening history panel
 * @param {Function} props.onToggleDebug - Handler for toggling debug panel
 * @param {boolean} props.showDebug - Whether debug panel is visible
 * @param {string} props.statusText - Save status text
 * @param {string} props.clientBuildTime - Client build timestamp
 * @param {string} props.serverBuildTime - Server build timestamp
 * @param {string} [props.healthFetchedAt] - Last health check timestamp
 */
export function TopBar({
  activeTab,
  onSelectTab,
  onOpenCheckpoint,
  onShowHistory,
  onToggleDebug,
  showDebug,
  statusText,
  clientBuildTime,
  serverBuildTime,
  healthFetchedAt
}) {
  return (
    <div className="topbar">
      <div className="version-banner">
        <span>Client built {formatTimestamp(clientBuildTime)}</span>
        <span>Server built {formatTimestamp(serverBuildTime)}</span>
        {healthFetchedAt && <span>Checked {formatTimestamp(healthFetchedAt)}</span>}
      </div>
      <header>
        <h1>Daily Worklog</h1>
        <div className="spacer" />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={onOpenCheckpoint}>Checkpoint</button>
        <button className="btn" onClick={onShowHistory}>History</button>
        <button className="btn" onClick={onToggleDebug}>{showDebug ? 'Hide' : 'Show'} Debug</button>
        <div className="save-indicator">{statusText}</div>
      </header>
    </div>
  )
}
