import React from 'react'
import { formatTimestamp } from '../utils/formatTimestamp.js'

const TABS = [
  { id: 'outline', label: 'Outline' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'reminders', label: 'Reminders' }
]

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
