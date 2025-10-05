import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import OutlinerView from './views/OutlinerView.jsx'
import { ReminderNotificationBar } from './components/ReminderNotificationBar.jsx'
import { CheckpointModal } from './components/CheckpointModal.jsx'
import { TopBar } from './components/TopBar.jsx'
import { TabPanel } from './components/TabPanel.jsx'
import { useReminders } from './context/ReminderContext.jsx'
import { useBuildInfo } from './hooks/useBuildInfo.js'
import { usePersistentFlag } from './hooks/usePersistentFlag.js'
import { useFocusRouter } from './hooks/useFocusRouter.js'
import { useActiveTab } from './hooks/useActiveTab.js'
import { useHistoryPanel } from './hooks/useHistoryPanel.js'
import { useCheckpointDialog } from './hooks/useCheckpointDialog.js'
import { CLIENT_BUILD_TIME, TAB_IDS, APP_NAME, APP_VERSION } from './constants/config.js'

// Lazy-load secondary views
const TimelineView = lazy(() => import('./views/TimelineView.jsx'))
const RemindersView = lazy(() => import('./views/RemindersView.jsx'))
const HistoryModal = lazy(() => import('./views/HistoryModal.jsx'))

export default function App() {
  const [saveState, setSaveState] = useState({ dirty: false, saving: false })
  const [checkpointNote, setCheckpointNote] = useState('')
  const [checkpointStatus, setCheckpointStatus] = useState({ state: 'idle', message: '' })

  const { activeTab, setActiveTab } = useActiveTab(TAB_IDS.OUTLINE)
  const { isHistoryOpen, openHistory, closeHistory } = useHistoryPanel()
  const {
    checkpointOpen,
    checkpointBusy,
    checkpointError,
    openCheckpoint: openCheckpointDialog,
    closeCheckpoint: closeCheckpointDialog,
    createCheckpoint: createCheckpointAction
  } = useCheckpointDialog()

  const { value: showDebug, toggle: toggleDebug } = usePersistentFlag('WL_DEBUG', true)
  const { serverBuildTime, healthFetchedAt } = useBuildInfo()

  const { pendingReminders } = useReminders()
  const hasPendingReminders = pendingReminders.length > 0

  const {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  } = useFocusRouter(setActiveTab)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__APP_ACTIVE_TAB__ = activeTab
      window.__APP_SET_TAB__ = setActiveTab
    }
  }, [activeTab, setActiveTab])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = `${APP_NAME} v${APP_VERSION}`
    }
  }, [])

  const openCheckpoint = useCallback(() => {
    setCheckpointNote('')
    setCheckpointStatus({ state: 'idle', message: '' })
    openCheckpointDialog()
  }, [openCheckpointDialog])

  const closeCheckpoint = useCallback(() => {
    closeCheckpointDialog()
  }, [closeCheckpointDialog])

  const submitCheckpoint = useCallback(async (event) => {
    event.preventDefault()
    if (checkpointStatus.state === 'saving') return
    setCheckpointStatus({ state: 'saving', message: '' })

    try {
      await createCheckpointAction(checkpointNote.trim())
      setCheckpointStatus({ state: 'success', message: 'Checkpoint saved!' })
    } catch (err) {
      setCheckpointStatus({
        state: 'error',
        message: err?.message || 'Failed to save checkpoint'
      })
    }
  }, [checkpointNote, checkpointStatus.state, createCheckpointAction])

  const handleViewHistory = useCallback(() => {
    closeCheckpointDialog()
    openHistory()
  }, [closeCheckpointDialog, openHistory])

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
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenCheckpoint={openCheckpoint}
        onShowHistory={openHistory}
        onToggleDebug={handleToggleDebug}
        showDebug={showDebug}
        statusText={statusText}
        clientBuildTime={CLIENT_BUILD_TIME}
        serverBuildTime={serverBuildTime}
        healthFetchedAt={healthFetchedAt}
        appName={APP_NAME}
        appVersion={APP_VERSION}
      />
      <main>
        <TabPanel active={activeTab === TAB_IDS.OUTLINE}>
          <OutlinerView
            onSaveStateChange={setSaveState}
            showDebug={showDebug}
            focusRequest={outlineFocusRequest}
            onFocusHandled={handleOutlineFocusHandled}
            onRequestTimelineFocus={requestTimelineFocus}
          />
        </TabPanel>
        <TabPanel active={activeTab === TAB_IDS.TIMELINE}>
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <TimelineView
              focusRequest={timelineFocusRequest}
              onFocusHandled={handleTimelineFocusHandled}
              onNavigateOutline={requestOutlineFocus}
            />
          </Suspense>
        </TabPanel>
        <TabPanel active={activeTab === TAB_IDS.REMINDERS}>
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <RemindersView />
          </Suspense>
        </TabPanel>
      </main>
      <ReminderNotificationBar
        visible={hasPendingReminders}
        onNavigateOutline={requestOutlineFocus}
      />
      {isHistoryOpen && (
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <HistoryModal
            onClose={closeHistory}
            onRestored={() => window.location.reload()}
          />
        </Suspense>
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
