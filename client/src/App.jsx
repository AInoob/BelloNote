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
const INITIAL_TAB = 'outline'
const INITIAL_CHECKPOINT_STATUS = { state: 'idle', message: '' }

function getInitialTab() {
  if (typeof window === 'undefined') return INITIAL_TAB
  return INITIAL_TAB
}

function useActiveTab() {
  const [tab, setTab] = useState(getInitialTab)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.__APP_ACTIVE_TAB__ = tab
    window.__APP_SET_TAB__ = setTab
  }, [tab])

  return { tab, setTab }
}

function useHistoryPanel(initialState = false) {
  const [isOpen, setOpen] = useState(initialState)

  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])

  return { isOpen, open, close }
}

function useCheckpointDialog() {
  const [isOpen, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [status, setStatus] = useState(INITIAL_CHECKPOINT_STATUS)

  const open = useCallback(() => {
    setNote('')
    setStatus(INITIAL_CHECKPOINT_STATUS)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const submit = useCallback(async (event) => {
    event.preventDefault()
    if (status.state === 'saving') return

    setStatus({ state: 'saving', message: '' })

    try {
      await createCheckpoint(note.trim())
      setStatus({ state: 'success', message: 'Checkpoint saved!' })
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Failed to save checkpoint'
      })
    }
  }, [note, status.state])

  return {
    isOpen,
    note,
    setNote,
    status,
    open,
    close,
    submit
  }
}

function useStatusText(saveState) {
  return useMemo(() => {
    if (saveState.saving) return 'Saving…'
    return saveState.dirty ? 'Unsaved changes' : 'Saved'
  }, [saveState.dirty, saveState.saving])
}

export default function App() {
  const { tab, setTab } = useActiveTab()
  const historyPanel = useHistoryPanel()
  const {
    isOpen: checkpointOpen,
    note: checkpointNote,
    setNote: setCheckpointNote,
    status: checkpointStatus,
    open: openCheckpoint,
    close: closeCheckpoint,
    submit: submitCheckpoint
  } = useCheckpointDialog()

  const [saveState, setSaveState] = useState({ dirty: false, saving: false })
  const { value: showDebug, toggle: toggleDebug } = usePersistentFlag('WL_DEBUG', true)
  const { serverBuildTime, healthFetchedAt } = useBuildInfo()

  const { pendingReminders } = useReminders()
  const hasPendingReminders = useMemo(() => pendingReminders.length > 0, [pendingReminders])

  const {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  } = useFocusRouter(setTab)

  const showHistoryPanel = historyPanel.open
  const closeHistoryPanel = historyPanel.close
  const { isOpen: showHistory } = historyPanel

  const handleToggleDebug = useCallback(() => {
    toggleDebug()
  }, [toggleDebug])

  const handleViewHistory = useCallback(() => {
    closeCheckpoint()
    showHistoryPanel()
  }, [closeCheckpoint, showHistoryPanel])

  const statusText = useStatusText(saveState)

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
