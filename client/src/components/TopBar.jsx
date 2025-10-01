import React, { useCallback, useMemo } from 'react'
import { formatTimestamp } from '../utils/formatTimestamp.js'

const TABS = [
  { id: 'outline', label: 'Outline' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'reminders', label: 'Reminders' }
]

const DEFAULT_TAB_CLASS = 'btn'
const ACTIVE_TAB_CLASS = 'btn active'

function VersionStamp({ label, value, hideWhenEmpty = false }) {
  if (hideWhenEmpty && !value) return null
  return <span>{label} {formatTimestamp(value)}</span>
}

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
  const handleTabSelect = useCallback((tabId) => {
    onSelectTab?.(tabId)
  }, [onSelectTab])

  const debugLabel = useMemo(() => (showDebug ? 'Hide Debug' : 'Show Debug'), [showDebug])

  return (
    <div className="topbar">
      <div className="version-banner">
        <VersionStamp label="Client built" value={clientBuildTime} />
        <VersionStamp label="Server built" value={serverBuildTime} />
        <VersionStamp label="Checked" value={healthFetchedAt} hideWhenEmpty />
      </div>
      <header>
        <h1>Daily Worklog</h1>
        <div className="spacer" />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? ACTIVE_TAB_CLASS : DEFAULT_TAB_CLASS}
            onClick={() => handleTabSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={onOpenCheckpoint}>Checkpoint</button>
        <button className="btn" onClick={onShowHistory}>History</button>
        <button className="btn" onClick={onToggleDebug}>{debugLabel}</button>
        <div className="save-indicator">{statusText}</div>
      </header>
    </div>
  )
}
