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

const CLIENT_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null

function getInitialTab() {
  if (typeof window === 'undefined') return 'outline'
  return 'outline'
}

export default function App() {
  const [tab, setTab] = useState(getInitialTab)
  const [saveState, setSaveState] = useState({ dirty: false, saving: false })
  const [showHistory, setShowHistory] = useState(false)
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [checkpointNote, setCheckpointNote] = useState('')
  const [checkpointStatus, setCheckpointStatus] = useState({ state: 'idle', message: '' })
  const { value: showDebug, toggle: toggleDebug } = usePersistentFlag('WL_DEBUG', true)
  const { serverBuildTime, healthFetchedAt } = useBuildInfo()

  const { pendingReminders } = useReminders()
  const hasPendingReminders = pendingReminders.length > 0

  const showHistoryPanel = useCallback(() => {
    setShowHistory(true)
  }, [setShowHistory])

  const closeHistoryPanel = useCallback(() => {
    setShowHistory(false)
  }, [setShowHistory])

  const {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  } = useFocusRouter(setTab)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__APP_ACTIVE_TAB__ = tab
      window.__APP_SET_TAB__ = setTab
    }
  }, [tab])

  const openCheckpoint = useCallback(() => {
    setCheckpointNote('')
    setCheckpointStatus({ state: 'idle', message: '' })
    setCheckpointOpen(true)
  }, [])

  const closeCheckpoint = useCallback(() => {
    setCheckpointOpen(false)
  }, [])

  const submitCheckpoint = useCallback(async (event) => {
    event.preventDefault()
    if (checkpointStatus.state === 'saving') return
    setCheckpointStatus({ state: 'saving', message: '' })

    try {
      await createCheckpoint(checkpointNote.trim())
      setCheckpointStatus({ state: 'success', message: 'Checkpoint saved!' })
    } catch (err) {
      setCheckpointStatus({
        state: 'error',
        message: err?.message || 'Failed to save checkpoint'
      })
    }
  }, [checkpointNote, checkpointStatus.state])

  const handleViewHistory = useCallback(() => {
    setCheckpointOpen(false)
    showHistoryPanel()
  }, [showHistoryPanel])

  const handleToggleDebug = useCallback(() => {
    toggleDebug()
  }, [toggleDebug])

  const statusText = useMemo(() => {
    if (saveState.saving) return 'Saving…'
    return saveState.dirty ? 'Unsaved changes' : 'Saved'
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
