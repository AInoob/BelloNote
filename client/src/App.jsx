import React, { useCallback, useEffect, useMemo, useState } from 'react'
import OutlinerView from './views/OutlinerView.jsx'
import TimelineView from './views/TimelineView.jsx'
import RemindersView from './views/RemindersView.jsx'
import HistoryModal from './views/HistoryModal.jsx'
import { createCheckpoint } from './api.js'
import { ReminderNotificationBar } from './components/ReminderNotificationBar.jsx'
import { CheckpointModal } from './components/CheckpointModal.jsx'
import { TopBar } from './components/TopBar.jsx'
import { TabPanel } from './components/TabPanel.jsx'
import { useReminders } from './context/ReminderContext.jsx'
import { useBuildInfo } from './hooks/useBuildInfo.js'
import { usePersistentFlag } from './hooks/usePersistentFlag.js'
import { useFocusRouter } from './hooks/useFocusRouter.js'

// ============================================================================
// Constants
// ============================================================================

const CLIENT_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null
const DEFAULT_TAB = 'outline'
const DEBUG_FLAG_KEY = 'WL_DEBUG'
const DEBUG_DEFAULT = true

// Checkpoint states
const CHECKPOINT_STATE = {
  IDLE: 'idle',
  SAVING: 'saving',
  SUCCESS: 'success',
  ERROR: 'error'
}

// Save states
const SAVE_TEXT = {
  SAVING: 'Saving…',
  DIRTY: 'Unsaved changes',
  SAVED: 'Saved'
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the initial tab to display
 * @returns {string} The initial tab name
 */
function getInitialTab() {
  if (typeof window === 'undefined') return DEFAULT_TAB
  return DEFAULT_TAB
}

// ============================================================================
// Main Component
// ============================================================================

export default function App() {
  // State
  const [tab, setTab] = useState(getInitialTab)
  const [saveState, setSaveState] = useState({ dirty: false, saving: false })
  const [showHistory, setShowHistory] = useState(false)
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [checkpointNote, setCheckpointNote] = useState('')
  const [checkpointStatus, setCheckpointStatus] = useState({
    state: CHECKPOINT_STATE.IDLE,
    message: ''
  })

  // Hooks
  const { value: showDebug, toggle: toggleDebug } = usePersistentFlag(DEBUG_FLAG_KEY, DEBUG_DEFAULT)
  const { serverBuildTime, healthFetchedAt } = useBuildInfo()

  const { pendingReminders } = useReminders()
  const hasPendingReminders = pendingReminders.length > 0

  // Focus router for coordinating between views
  const {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  } = useFocusRouter(setTab)

  // History panel handlers
  const showHistoryPanel = useCallback(() => {
    setShowHistory(true)
  }, [])

  const closeHistoryPanel = useCallback(() => {
    setShowHistory(false)
  }, [])

  // Checkpoint modal handlers
  const openCheckpoint = useCallback(() => {
    setCheckpointNote('')
    setCheckpointStatus({ state: CHECKPOINT_STATE.IDLE, message: '' })
    setCheckpointOpen(true)
  }, [])

  const closeCheckpoint = useCallback(() => {
    setCheckpointOpen(false)
  }, [])

  const handleViewHistory = useCallback(() => {
    setCheckpointOpen(false)
    showHistoryPanel()
  }, [showHistoryPanel])

  const handleToggleDebug = useCallback(() => {
    toggleDebug()
  }, [toggleDebug])

  // Effects
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__APP_ACTIVE_TAB__ = tab
      window.__APP_SET_TAB__ = setTab
    }
  }, [tab])

  const submitCheckpoint = useCallback(async (event) => {
    event.preventDefault()
    if (checkpointStatus.state === CHECKPOINT_STATE.SAVING) return

    setCheckpointStatus({ state: CHECKPOINT_STATE.SAVING, message: '' })

    try {
      await createCheckpoint(checkpointNote.trim())
      setCheckpointStatus({
        state: CHECKPOINT_STATE.SUCCESS,
        message: 'Checkpoint saved!'
      })
    } catch (err) {
      setCheckpointStatus({
        state: CHECKPOINT_STATE.ERROR,
        message: err?.message || 'Failed to save checkpoint'
      })
    }
  }, [checkpointNote, checkpointStatus.state])

  // Computed values
  const statusText = useMemo(() => {
    if (saveState.saving) return SAVE_TEXT.SAVING
    return saveState.dirty ? SAVE_TEXT.DIRTY : SAVE_TEXT.SAVED
  }, [saveState.dirty, saveState.saving])

  return (
    <>
      <TopBar
        activeTab={tab}
        onSelectTab={setTab}
        onOpenCheckpoint={openCheckpoint}
        onShowHistory={showHistoryPanel}
        onToggleDebug={handleToggleDebug}
        showDebug={showDebug}
        statusText={statusText}
        clientBuildTime={CLIENT_BUILD_TIME}
        serverBuildTime={serverBuildTime}
        healthFetchedAt={healthFetchedAt}
      />
      <main>
        <TabPanel active={tab === 'outline'}>
          <OutlinerView
            onSaveStateChange={setSaveState}
            showDebug={showDebug}
            focusRequest={outlineFocusRequest}
            onFocusHandled={handleOutlineFocusHandled}
            onRequestTimelineFocus={requestTimelineFocus}
          />
        </TabPanel>
        <TabPanel active={tab === 'timeline'}>
          <TimelineView
            focusRequest={timelineFocusRequest}
            onFocusHandled={handleTimelineFocusHandled}
            onNavigateOutline={requestOutlineFocus}
          />
        </TabPanel>
        <TabPanel active={tab === 'reminders'}>
          <RemindersView />
        </TabPanel>
      </main>
      <ReminderNotificationBar
        visible={hasPendingReminders}
        onNavigateOutline={requestOutlineFocus}
      />
      {showHistory && (
        <HistoryModal
          onClose={closeHistoryPanel}
          onRestored={() => window.location.reload()}
        />
      )}
      {checkpointOpen && (
        <CheckpointModal
          note={checkpointNote}
          onChange={setCheckpointNote}
          status={checkpointStatus}
          onSubmit={submitCheckpoint}
          onClose={closeCheckpoint}
          onViewHistory={handleViewHistory}
        />
      )}
    </>
  )
}
