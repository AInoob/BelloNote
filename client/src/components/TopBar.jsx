import React from 'react'
import { formatTimestamp } from '../utils/formatTimestamp.js'
import { TABS } from '../constants/tabs.js'

/**
 * Version banner component showing build times
 */
function VersionBanner({ clientBuildTime, serverBuildTime, healthFetchedAt }) {
  return (
    <div className="version-banner">
      <span>Client built {formatTimestamp(clientBuildTime)}</span>
      <span>Server built {formatTimestamp(serverBuildTime)}</span>
      {healthFetchedAt && <span>Checked {formatTimestamp(healthFetchedAt)}</span>}
    </div>
  )
}

/**
 * Tab navigation buttons
 */
function TabNavigation({ activeTab, onSelectTab }) {
  return (
    <>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </>
  )
}

/**
 * Action buttons (Checkpoint, History, Debug)
 */
function ActionButtons({ onOpenCheckpoint, onShowHistory, onToggleDebug, showDebug }) {
  return (
    <>
      <button className="btn" onClick={onOpenCheckpoint}>
        Checkpoint
      </button>
      <button className="btn" onClick={onShowHistory}>
        History
      </button>
      <button className="btn" onClick={onToggleDebug}>
        {showDebug ? 'Hide' : 'Show'} Debug
      </button>
    </>
  )
}

/**
 * Top navigation bar component
 * Contains version info, tab navigation, action buttons, and save status
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
      <VersionBanner
        clientBuildTime={clientBuildTime}
        serverBuildTime={serverBuildTime}
        healthFetchedAt={healthFetchedAt}
      />
      <header>
        <h1>Bello Note</h1>
        <div className="spacer" />
        <TabNavigation activeTab={activeTab} onSelectTab={onSelectTab} />
        <div className="spacer" />
        <ActionButtons
          onOpenCheckpoint={onOpenCheckpoint}
          onShowHistory={onShowHistory}
          onToggleDebug={onToggleDebug}
          showDebug={showDebug}
        />
        <div className="save-indicator">{statusText}</div>
      </header>
    </div>
  )
}
