
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ImageWithMeta } from '../extensions/imageWithMeta.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import ListItem from '@tiptap/extension-list-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { lowlight } from 'lowlight/lib/core.js'
import dayjs from 'dayjs'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import { ReplaceAroundStep } from 'prosemirror-transform'
import { liftListItem, splitListItem } from 'prosemirror-schema-list'
import { API_ROOT, absoluteUrl, getOutline, saveOutlineApi, uploadImage } from '../api.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'
import { WorkDateHighlighter } from '../extensions/workDateHighlighter'
import { ReminderTokenInline } from '../extensions/reminderTokenInline.js'
import { DetailsBlock } from '../extensions/detailsBlock.jsx'
import { safeReactNodeViewRenderer } from '../tiptap/safeReactNodeViewRenderer.js'
import { useSlashCommands } from './outliner/useSlashCommands.js'
import { useReminderActions } from './outliner/useReminderActions.js'
import { useActiveTask } from './outliner/useActiveTask.js'
import { useImageHandling } from './outliner/useImageHandling.js'
import { useSearchHighlight } from './outliner/useSearchHighlight.js'
import { useOutlineSync } from './outliner/useOutlineSync.js'
import { useStatusFilter } from './outliner/useStatusFilter.js'
import { useDragDrop } from './outliner/useDragDrop.js'
import { createEditorProps } from './outliner/createEditorProps.js'
import { useFocusMode } from './outliner/useFocusMode.js'
import { useTagFilters } from './outliner/useTagFilters.js'
import {
  findListItemDepth,
  runListIndentCommand,
  runSplitListItemWithSelection,
  applySplitStatusAdjustments,
  promoteSplitSiblingToChild,
  moveIntoFirstChild
} from './outliner/listItemHelpers.js'
import {
  LOG_ON,
  LOG,
  loadCollapsedSetForRoot,
  saveCollapsedSetForRoot,
  focusContextDefaults,
  FocusContext,
  cssEscape,
  gatherOwnListItemText,
  DEFAULT_STATUS_FILTER,
  loadStatusFilter,
  saveStatusFilter,
  loadArchivedVisible,
  saveArchivedVisible,
  loadFutureVisible,
  saveFutureVisible,
  loadSoonVisible,
  saveSoonVisible,
  DEFAULT_TAG_FILTER,
  loadTagFilters,
  saveTagFilters,
  loadScrollState,
  migrateCollapsedSets
} from './outliner/filterUtils.js'
import { CodeBlockView } from './outliner/CodeBlockView.jsx'
import { createTaskListItemExtension } from './outliner/createTaskListItemExtension.jsx'
import { ListItemView } from './outliner/ListItemView.jsx'
import { FilterBar } from './outliner/FilterBar.jsx'
import { availableFilters, toggleStatusFilter as toggleStatusFilterBase, applyPresetFilter as applyPresetFilterBase } from './outliner/filterPresets.js'
import { applyCollapsedStateForRoot as applyCollapsedStateForRootBase } from './outliner/collapseHelpers.js'
import { SlashMenu } from './outliner/SlashMenu.jsx'
import { DatePicker } from './outliner/DatePicker.jsx'
import { ImagePreview } from './outliner/ImagePreview.jsx'
import { FocusBanner } from './outliner/FocusBanner.jsx'
import { DebugPane } from './outliner/DebugPane.jsx'
import { parseTagInput, extractTagsFromText } from './outliner/tagUtils.js'
import {
  normalizeBodyNodes,
  parseBodyContent,
  defaultBody,
  buildList,
  parseOutline,
  cloneOutline,
  moveNodeInOutline,
  extractTitle,
  extractDates
} from './outliner/outlineUtils.js'
import {
  REMINDER_TOKEN_REGEX,
  parseReminderTokenFromText,
  reminderIsDue,
  computeReminderDisplay,
  stripReminderDisplayBreaks
} from '../utils/reminderTokens.js'
import {
  extractOutlineClipboardPayload,
  prepareClipboardData
} from '../utils/outlineClipboard.js'

const STATUS_EMPTY = ''
const STATUS_ORDER = ['todo', 'in-progress', 'done', STATUS_EMPTY]
const STATUS_ICON = { [STATUS_EMPTY]: '', 'todo': '○', 'in-progress': '◐', 'done': '✓' }
const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const STARTER_PLACEHOLDER_TITLE = 'Start here'

export default function OutlinerView({
  onSaveStateChange = () => {},
  showDebug = false,
  readOnly = false,
  broadcastSnapshots = true,
  initialOutline = null,
  forceExpand = false,
  allowStatusToggleInReadOnly = false,
  onStatusToggle = null,
  reminderActionsEnabled: reminderActionsEnabledProp,
  onActiveTaskChange = null,
  focusRequest = null,
  onFocusHandled = () => {},
  onRequestTimelineFocus = null
}) {
  const isReadOnly = !!readOnly
  const reminderActionsEnabled = reminderActionsEnabledProp !== undefined ? reminderActionsEnabledProp : !isReadOnly
  const [debugLines, setDebugLines] = useState([])
  const slashHandlersRef = useRef({ handleKeyDown: () => false, openAt: () => {} })
  const [showFuture, setShowFuture] = useState(() => loadFutureVisible())
  const [showSoon, setShowSoon] = useState(() => loadSoonVisible())
  const [imagePreview, setImagePreview] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => loadStatusFilter())
  const [showArchived, setShowArchived] = useState(() => loadArchivedVisible())
  const [tagFilters, setTagFilters] = useState(() => loadTagFilters())
  const applyStatusFilterRef = useRef(null)

  const {
    applyStatusFilter,
    scheduleApplyStatusFilter,
    showFutureRef,
    showSoonRef,
    showArchivedRef,
    statusFilterRef,
    tagFiltersRef,
    filterScheduleRef,
    lastFilterRunAtRef
  } = useStatusFilter({
    editor,
    statusFilter,
    showArchived,
    showFuture,
    showSoon,
    tagFilters,
    focusRootRef
  })

  const {
    includeTagInput,
    setIncludeTagInput,
    excludeTagInput,
    setExcludeTagInput,
    addTagFilter: addTagFilterBase,
    removeTagFilter: removeTagFilterBase,
    clearTagFilters: clearTagFiltersBase,
    handleTagInputChange,
    handleTagInputKeyDown: handleTagInputKeyDownBase,
    handleTagInputBlur: handleTagInputBlurBase
  } = useTagFilters({ tagFiltersRef })

  const addTagFilter = useCallback((mode, value) => addTagFilterBase(mode, value, setTagFilters), [addTagFilterBase])
  const removeTagFilter = useCallback((mode, tag) => removeTagFilterBase(mode, tag, setTagFilters), [removeTagFilterBase])
  const clearTagFilters = useCallback(() => clearTagFiltersBase(setTagFilters), [clearTagFiltersBase])
  const handleTagInputKeyDown = useCallback((mode) => handleTagInputKeyDownBase(mode, setTagFilters), [handleTagInputKeyDownBase])
  const handleTagInputBlur = useCallback((mode) => handleTagInputBlurBase(mode, setTagFilters), [handleTagInputBlurBase])

  const emitOutlineSnapshot = useCallback((outline) => {
    if (!broadcastSnapshots) return
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('worklog:outline-snapshot', { detail: { outline } }))
    } catch (err) {
      console.error('[outline] notify snapshot failed', err)
    }
  }, [broadcastSnapshots])

  const { dirty, saving, markDirty, queueSave, doSave } = useOutlineSync({
    editor,
    isReadOnly,
    parseOutline: () => parseOutline(editor, { normalizeImageSrc, pushDebug }),
    emitOutlineSnapshot,
    pushDebug,
    migrateCollapsedSets,
    onFocusRootIdMapped: useCallback((mapping) => {
      if (focusRootRef.current && mapping[focusRootRef.current]) {
        const nextId = String(mapping[focusRootRef.current])
        suppressUrlSyncRef.current = true
        setFocusRootId(nextId)
        if (typeof window !== 'undefined') {
          try {
            const url = new URL(window.location.href)
            url.searchParams.set('focus', nextId)
            window.history.replaceState({ focus: nextId }, '', url)
          } catch {}
        }
      }
    }, [])
  })

  const includeInputRef = useRef(null)
  const excludeInputRef = useRef(null)
  const restoredScrollRef = useRef(false)
  const scrollSaveFrameRef = useRef(null)
  const filterRunCounterRef = useRef(0)
  const editorRef = useRef(null)
  const computeActiveTaskRef = useRef(null)
  const logCursorTimingRef = useRef(null)

  // Persist filters in localStorage
  useEffect(() => { saveStatusFilter(statusFilter) }, [statusFilter])
  useEffect(() => { saveSoonVisible(showSoon) }, [showSoon])
  useEffect(() => { saveArchivedVisible(showArchived) }, [showArchived])
  useEffect(() => { saveFutureVisible(showFuture) }, [showFuture])
  const draggingRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const suppressSelectionRestoreRef = useRef(false)
  const pendingEmptyCaretRef = useRef(false)
  const includeFilterList = Array.isArray(tagFilters?.include) ? tagFilters.include : []
  const excludeFilterList = Array.isArray(tagFilters?.exclude) ? tagFilters.exclude : []
  const hasTagFilters = includeFilterList.length > 0 || excludeFilterList.length > 0

  const taskListItemExtension = useMemo(
    () => createTaskListItemExtension({
      readOnly: isReadOnly,
      draggingState: draggingRef,
      allowStatusToggleInReadOnly,
      onStatusToggle,
      reminderActionsEnabled,
      ListItemView
    }),
    [isReadOnly, draggingRef, allowStatusToggleInReadOnly, onStatusToggle, reminderActionsEnabled]
  )

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])

  const pushDebug = (msg, extra={}) => {
    const line = `${new Date().toLocaleTimeString()} ${msg} ${Object.keys(extra).length? JSON.stringify(extra): ''}`
    setDebugLines(s => [...s.slice(-200), line])
    LOG(msg, extra)
  }

  const CodeBlockWithCopy = useMemo(
    () => CodeBlockLowlight.extend({
      addNodeView() {
        return safeReactNodeViewRenderer(CodeBlockView)
      }
    }).configure({ lowlight }),
    []
  )

  const imageExtension = useMemo(
    () => ImageWithMeta.configure({ inline: true, allowBase64: true }),
    []
  )

  const extensions = useMemo(() => [
    StarterKit.configure({ listItem: false, codeBlock: false }),
    taskListItemExtension,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    Highlight.configure({ multicolor: true }),
    imageExtension,
    CodeBlockWithCopy,
    WorkDateHighlighter,
    ReminderTokenInline,
    DetailsBlock
  ], [taskListItemExtension, CodeBlockWithCopy, imageExtension])

  const editorProps = useMemo(() => createEditorProps({
    isReadOnly,
    get editor() { return editorRef.current },
    pushDebug,
    slashHandlersRef,
    focusRootRef,
    pendingFocusScrollRef,
    setFocusRootId,
    onRequestTimelineFocus,
    get computeActiveTask() { return computeActiveTaskRef.current },
    markDirty,
    doSave,
    runSplitListItemWithSelection,
    applySplitStatusAdjustments,
    promoteSplitSiblingToChild,
    runListIndentCommand,
    moveIntoFirstChild,
    get logCursorTiming() { return logCursorTimingRef.current },
    suppressSelectionRestoreRef,
    pendingEmptyCaretRef
  }), [isReadOnly, pushDebug, setFocusRootId, onRequestTimelineFocus, markDirty, doSave])

  const editor = useEditor({
    // disable default codeBlock to avoid duplicate name with CodeBlockLowlight
    extensions,
    content: '<p>Loading…</p>',
    autofocus: false,
    editable: !isReadOnly,
    onCreate: () => { pushDebug('editor: ready'); scheduleApplyStatusFilter('editor.onCreate') },
    onUpdate: () => {
      if (!isReadOnly) {
        markDirty()
        queueSave()
      }
      scheduleApplyStatusFilter('editor.onUpdate')
    },
    editorProps
  })

  useEffect(() => {
    editorRef.current = editor
    if (typeof window !== 'undefined') {
      window.__WORKLOG_EDITOR = editor
      if (!isReadOnly) window.__WORKLOG_EDITOR_MAIN = editor
      else window.__WORKLOG_EDITOR_RO = editor
    }
    return () => {
      if (typeof window !== 'undefined') {
        if (window.__WORKLOG_EDITOR === editor) window.__WORKLOG_EDITOR = null
        if (!isReadOnly && window.__WORKLOG_EDITOR_MAIN === editor) window.__WORKLOG_EDITOR_MAIN = null
        if (isReadOnly && window.__WORKLOG_EDITOR_RO === editor) window.__WORKLOG_EDITOR_RO = null
      }
    }
  }, [editor, isReadOnly])

  const { normalizeImageSrc } = useImageHandling({ editor, isReadOnly })
  useSearchHighlight({ editor, searchQuery, searchQueryRef, suppressSelectionRestoreRef })

  useEffect(() => { onSaveStateChange({ dirty, saving }) }, [dirty, saving])

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const img = target.closest('img')
      if (img && dom.contains(img)) {
        event.preventDefault()
        const src = absoluteUrl(img.getAttribute('src') || '')
        setImagePreview(src)
        pushDebug('image: preview open', { src })
      }
    }
    dom.addEventListener('click', handler)
    return () => dom.removeEventListener('click', handler)
  }, [editor, pushDebug])

  const {
    slashOpen,
    slashPos,
    slashQuery,
    setSlashQuery,
    slashActiveIndex,
    updateSlashActive,
    slashInputRef,
    filteredCommands,
    closeSlash,
    menuRef,
    datePickerOpen,
    setDatePickerOpen,
    datePickerValueRef,
    applyPickedDate,
    handleKeyDown: slashHandleKeyDown,
    handleSlashInputKeyDown,
    openSlashAt
  } = useSlashCommands({ editor, isReadOnly, pushDebug })

  slashHandlersRef.current.handleKeyDown = slashHandleKeyDown
  slashHandlersRef.current.openAt = openSlashAt

  const applyCollapsedStateForRoot = useCallback((rootId) => applyCollapsedStateForRootBase(editor, rootId, forceExpand), [editor, forceExpand])
  const toggleStatusFilter = (key) => toggleStatusFilterBase(statusFilter, statusFilterRef, setStatusFilter, key)
  const applyPresetFilter = (preset) => applyPresetFilterBase(statusFilterRef, setStatusFilter, preset)

  const logCursorTiming = useCallback((label, startedAt) => {
    if (!editor || !editor.view) return
    const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
    const base = typeof startedAt === 'number' ? startedAt : now()
    const view = editor.view
    const emit = (phase, ts) => {
      const selection = view.state.selection
      const data = {
        label,
        elapsed: Math.max(0, ts - base),
        from: selection?.from ?? null,
        to: selection?.to ?? null
      }
      console.log('[cursor]', phase, data)
    }
    emit('post-dispatch', now())
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => emit('raf', now()))
    }
    setTimeout(() => emit('timeout-32ms', now()), 32)
  }, [editor])

  logCursorTimingRef.current = logCursorTiming

  const { computeActiveTask, activeTaskInfoRef } = useActiveTask({ editor, onActiveTaskChange })

  computeActiveTaskRef.current = computeActiveTask

  const {
    focusRootId,
    setFocusRootId,
    focusRootRef,
    focusTitle,
    focusDisplayTitle,
    focusContextValue,
    handleRequestFocus,
    exitFocus,
    focusTaskById,
    pendingFocusScrollRef,
    suppressUrlSyncRef
  } = useFocusMode({
    editor,
    forceExpand,
    scheduleApplyStatusFilter,
    applyCollapsedStateForRoot,
    applyStatusFilter,
    computeActiveTask,
    activeTaskInfoRef,
    focusRequest,
    onFocusHandled
  })

  useEffect(() => {
    tagFiltersRef.current = tagFilters
    saveTagFilters(tagFilters)
    applyStatusFilter()
  }, [tagFilters, applyStatusFilter])

  useEffect(() => {
    applyStatusFilter()
  }, [applyStatusFilter])
  useEffect(() => { applyStatusFilterRef.current = applyStatusFilter }, [applyStatusFilter])
  // Observe DOM changes to ensure filters apply when NodeViews finish mounting (first load, etc.)
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    let t = null
    const observer = new MutationObserver(() => {
      if (t) {
        clearTimeout(t.id)
      }
      const timeoutId = setTimeout(() => {
        t = null
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
        const lastRunAt = lastFilterRunAtRef.current || 0
        const sinceLast = now - lastRunAt
        if (filterScheduleRef.current) {
          return
        }
        if (sinceLast >= 0 && sinceLast < 30) {
          return
        }
        scheduleApplyStatusFilter('mutation-observer')
        t = null
      }, 50)
      t = { id: timeoutId }
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (t) clearTimeout(t.id)
    }
  }, [editor, scheduleApplyStatusFilter])


  useDragDrop({
    editor,
    isReadOnly,
    draggingRef,
    normalizeImageSrc,
    pushDebug,
    forceExpand,
    markDirty,
    queueSave,
    applyStatusFilter
  })

  useEffect(() => {
    if (!editor || !isReadOnly) return
    if (!initialOutline) return
    const roots = Array.isArray(initialOutline?.roots)
      ? initialOutline.roots
      : Array.isArray(initialOutline)
        ? initialOutline
        : (initialOutline?.roots || [])
    const doc = { type: 'doc', content: [buildList(roots, { forceExpand, normalizeImageSrc })] }
    editor.commands.setContent(doc)
    dirtyRef.current = false
    setDirty(false)
    applyStatusFilter()
    emitOutlineSnapshot(roots)
  }, [editor, initialOutline, isReadOnly, applyStatusFilter, emitOutlineSnapshot, forceExpand, normalizeImageSrc])


  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onCopy = (e) => {
      try {
        const payload = prepareClipboardData({ state: editor.view.state })
        if (!payload) return

        e.clipboardData?.setData('application/x-worklog-outline+json', JSON.stringify(payload.normalizedJson))
        e.clipboardData?.setData('text/html', payload.html)
        e.clipboardData?.setData('text/plain', payload.text)
        if (typeof window !== 'undefined') {
          window.__WORKLOG_TEST_COPY__ = { text: payload.text, json: JSON.stringify(payload.normalizedJson) }
        }
        e.preventDefault()
        pushDebug('copy: selection exported')
      } catch (err) {
        console.error('[copy] failed', err)
      }
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [editor])

  useEffect(() => {
    if (!editor || isReadOnly) return
    const performSave = () => {
      if (typeof window === 'undefined') return
      if (!restoredScrollRef.current) return
      try {
        const payload = {
          scrollY: window.scrollY,
          selectionFrom: editor?.state?.selection?.from ?? null,
          timestamp: Date.now()
        }
        localStorage.setItem(SCROLL_STATE_KEY, JSON.stringify(payload))
      } catch {}
    }
    const scheduleSave = () => {
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      scrollSaveFrameRef.current = requestAnimationFrame(performSave)
    }
    window.addEventListener('scroll', scheduleSave, { passive: true })
    window.addEventListener('beforeunload', performSave)
    editor.on('selectionUpdate', scheduleSave)
    return () => {
      window.removeEventListener('scroll', scheduleSave)
      window.removeEventListener('beforeunload', performSave)
      editor.off('selectionUpdate', scheduleSave)
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
    }
  }, [editor, isReadOnly])

  useEffect(() => {

    if (!editor || isReadOnly) return
    ;(async () => {
      const data = await getOutline()
      const roots = data.roots || []
      const doc = { type: 'doc', content: [buildList(roots, { forceExpand, normalizeImageSrc })] }
      editor.commands.setContent(doc)
      dirtyRef.current = false
      setDirty(false)
      pushDebug('loaded outline', { roots: roots.length })
      applyCollapsedStateForRoot(focusRootRef.current)
      // Ensure filters (status/archive) apply on first load
      scheduleApplyStatusFilter('initial-outline-load')
      setTimeout(() => {
        if (restoredScrollRef.current) return
        const state = loadScrollState()
        if (state && typeof state.scrollY === 'number') {
          window.scrollTo({ top: state.scrollY, behavior: 'auto' })
        }
        restoredScrollRef.current = true
      }, 120)
    })()
  }, [editor, isReadOnly, applyCollapsedStateForRoot, scheduleApplyStatusFilter])

  useEffect(() => {
    if (isReadOnly) return
    const handler = () => queueSave(0)
    window.addEventListener('worklog:request-save', handler)
    return () => window.removeEventListener('worklog:request-save', handler)
  }, [isReadOnly])

  useEffect(() => {
    if (!editor) return
    const handler = (event) => {
      const detail = event.detail || {}
      const taskId = detail.taskId
      const status = detail.status
      if (!taskId || !status) return
      const view = editor.view
      const { state } = view
      let tr = state.tr
      let mutated = false
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem') return
        if (String(node.attrs.dataId) === String(taskId)) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, status })
          mutated = true
          return false
        }
        return undefined
      })
      if (mutated) {
        view.dispatch(tr)
        scheduleApplyStatusFilter('status-change-event')
      }
    }
    window.addEventListener('worklog:task-status-change', handler)
    return () => window.removeEventListener('worklog:task-status-change', handler)
  }, [editor, scheduleApplyStatusFilter])


  const parseOutlineWrapper = useCallback(() => {
    return parseOutline(editor, { normalizeImageSrc, pushDebug })
  }, [editor, normalizeImageSrc, pushDebug])

  const { applyReminderAction } = useReminderActions({
    editor,
    markDirty,
    queueSave,
    parseOutline: parseOutlineWrapper,
    emitOutlineSnapshot
  })

  useEffect(() => {
    if (!editor) return undefined
    const handler = (event) => {
      const detail = event?.detail
      if (!detail) return
      applyReminderAction(detail)
    }
    window.addEventListener('worklog:reminder-action', handler)
    return () => window.removeEventListener('worklog:reminder-action', handler)
  }, [editor, applyReminderAction])


  return (
    <div style={{ position:'relative' }}>
      <FilterBar
        isReadOnly={isReadOnly}
        availableFilters={availableFilters}
        statusFilter={statusFilter}
        toggleStatusFilter={toggleStatusFilter}
        applyPresetFilter={applyPresetFilter}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        showFuture={showFuture}
        setShowFuture={setShowFuture}
        showSoon={showSoon}
        setShowSoon={setShowSoon}
        includeFilterList={includeFilterList}
        excludeFilterList={excludeFilterList}
        removeTagFilter={removeTagFilter}
        includeTagInput={includeTagInput}
        setIncludeTagInput={setIncludeTagInput}
        excludeTagInput={excludeTagInput}
        setExcludeTagInput={setExcludeTagInput}
        handleTagInputChange={handleTagInputChange}
        handleTagInputKeyDown={handleTagInputKeyDown}
        handleTagInputBlur={handleTagInputBlur}
        hasTagFilters={hasTagFilters}
        clearTagFilters={clearTagFilters}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        includeInputRef={includeInputRef}
        excludeInputRef={excludeInputRef}
        applyStatusFilterRef={applyStatusFilterRef}
        editor={editor}
      />
      <FocusBanner isVisible={!!focusRootId} title={focusDisplayTitle} onExit={exitFocus} />
      <FocusContext.Provider value={focusContextValue}>
        <EditorContent editor={editor} className="tiptap" />
      </FocusContext.Provider>
      <ImagePreview src={imagePreview} onClose={() => setImagePreview(null)} />
      <SlashMenu
        isOpen={slashOpen}
        menuRef={menuRef}
        slashPos={slashPos}
        slashQuery={slashQuery}
        setSlashQuery={setSlashQuery}
        slashActiveIndex={slashActiveIndex}
        updateSlashActive={updateSlashActive}
        slashInputRef={slashInputRef}
        filteredCommands={filteredCommands}
        closeSlash={closeSlash}
      />
      <DatePicker
        isOpen={datePickerOpen}
        slashPos={slashPos}
        datePickerValueRef={datePickerValueRef}
        applyPickedDate={applyPickedDate}
        onClose={() => setDatePickerOpen(false)}
      />

      <DebugPane isVisible={showDebug} debugLines={debugLines} />
    </div>
  )
}
