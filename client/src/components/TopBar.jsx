import React from 'react'
import { formatTimestamp } from '../utils/formatTimestamp.js'
import { TABS } from '../constants/tabs.js'

/**
 * Version banner component showing build times
 */
function VersionBanner({ clientBuildTime, serverBuildTime, healthFetchedAt, appName, appVersion }) {
  return (
    <div className="version-banner">
      {appName && <span>{appVersion ? `${appName} v${appVersion}` : appName}</span>}
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
 * Action buttons (Checkpoint, History)
 */
function ActionButtons({ onOpenCheckpoint, onShowHistory }) {
  return (
    <>
      <button className="btn" onClick={onOpenCheckpoint}>
        Checkpoint
      </button>
      <button className="btn" onClick={onShowHistory}>
        History
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
  statusText,
  clientBuildTime,
  serverBuildTime,
  healthFetchedAt,
  appName,
  appVersion
}) {
  return (
    <div className="topbar">
      <VersionBanner
        clientBuildTime={clientBuildTime}
        serverBuildTime={serverBuildTime}
        healthFetchedAt={healthFetchedAt}
        appName={appName}
        appVersion={appVersion}
      />
      <header>
        <h1>{appName || 'Bello Note'}</h1>
        <div className="spacer" />
        <TabNavigation activeTab={activeTab} onSelectTab={onSelectTab} />
        <div className="spacer" />
        <ActionButtons
          onOpenCheckpoint={onOpenCheckpoint}
          onShowHistory={onShowHistory}
        />
        <div className="save-indicator">{statusText}</div>
      </header>
    </div>
  )
}
