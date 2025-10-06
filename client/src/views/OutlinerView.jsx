
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { TextSelection } from 'prosemirror-state'
import StarterKit from '@tiptap/starter-kit'
import { ImageWithMeta } from '../extensions/imageWithMeta.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Link from '@tiptap/extension-link'
import { lowlight } from 'lowlight/lib/core.js'
import { absoluteUrl, getOutline } from '../api.js'
import { WorkDateHighlighter } from '../extensions/workDateHighlighter'
import { ReminderTokenInline } from '../extensions/reminderTokenInline.js'
import { DetailsBlock } from '../extensions/detailsBlock.jsx'
import { safeReactNodeViewRenderer } from '../tiptap/safeReactNodeViewRenderer.js'
import { useSlashCommands } from './outliner/useSlashCommands.js'
import { useReminderActions } from './outliner/useReminderActions.js'
import { useFocusShortcut } from './outliner/useFocusShortcut.js'
import { useDomMutationObserver } from './outliner/useDomMutationObserver.js'
import { useTaskStatusSync } from './outliner/useTaskStatusSync.js'
import { useScrollStateSaver } from './outliner/useScrollStateSaver.js'
import { useCopyHandler } from './outliner/useCopyHandler.js'
import { useReminderActionListener } from './outliner/useReminderActionListener.js'
import { useFocusModeBodyClass } from './outliner/useFocusModeBodyClass.js'
import { useFocusRootScroll } from './outliner/useFocusRootScroll.js'
import { useFocusTitleUpdater } from './outliner/useFocusTitleUpdater.js'
import { useFilterScheduler } from './outliner/useFilterScheduler.js'
import { useActiveTaskNotifier } from './outliner/useActiveTaskNotifier.js'
import { useModifierClickFocus } from './outliner/useModifierClickFocus.js'
import { useFocusUrlSync } from './outliner/useFocusUrlSync.js'
import { useCollapsedStateApplier } from './outliner/useCollapsedStateApplier.js'
import { readFocusFromLocation } from './outliner/editorNavigation.js'
import { normalizeBodyNodes } from './outliner/outlineParser.js'
import { AVAILABLE_FILTERS, toggleStatusFilter as toggleStatusFilterUtil, applyPresetFilter as applyPresetFilterUtil } from './outliner/statusFilterUtils.js'
import { buildList as buildListUtil, parseOutline as parseOutlineUtil } from './outliner/outlineBuilder.js'
import { applyStatusFilter as applyStatusFilterUtil } from './outliner/filterApplication.js'
import { doSave as doSaveUtil } from './outliner/saveHandler.js'
import {
  handleRequestFocus as handleRequestFocusUtil,
  focusTaskById as focusTaskByIdUtil,
  exitFocus as exitFocusUtil,
  updateFocusTitle as updateFocusTitleUtil
} from './outliner/focusHandlers.js'
import { computeActiveTask as computeActiveTaskUtil } from './outliner/activeTaskUtils.js'
import { FilterBar } from './outliner/FilterBar.jsx'
import { SlashMenu } from './outliner/SlashMenu.jsx'
import { ExportImportControls } from './outliner/ExportImportControls.jsx'
import { handleDragOver, handleDrop } from './outliner/dragDropHandlers.js'
import { handlePaste } from './outliner/pasteHandler.js'
import { handleKeyDown } from './outliner/keyDownHandler.js'
import { handleEnterKey } from './outliner/enterKeyHandler.js'

import { ensureUploadedImages } from './outliner/imageUploadUtils.js'
import {
  addTagFilter as addTagFilterUtil,
  removeTagFilter as removeTagFilterUtil,
  clearTagFilters as clearTagFiltersUtil,
  handleTagInputChange as handleTagInputChangeUtil
} from './outliner/tagFilterHandlers.js'
import {
  handleTagInputKeyDown as handleTagInputKeyDownUtil,
  handleTagInputBlur as handleTagInputBlurUtil
} from './outliner/tagInputHandlers.js'
import {
  loadCollapsedSetForRoot,
  saveCollapsedSetForRoot
} from './outliner/collapsedState.js'

import { FocusContext } from './outliner/FocusContext.js'
import { loadScrollState } from './outliner/scrollState.js'
import { now, logCursorTiming } from './outliner/performanceUtils.js'
import { cssEscape } from '../utils/cssEscape.js'
import {
  stripHighlightMarksFromDoc,
  stripHighlightMarksFromOutlineNodes
} from './outliner/highlightCleanup.js'
import {
  loadStatusFilter,
  saveStatusFilter,
  loadArchivedVisible,
  saveArchivedVisible,
  loadTagFilters,
  saveTagFilters
} from './outliner/filterUtils.js'
import { CodeBlockView } from './outliner/CodeBlockView.jsx'
import { createTaskListItemExtension } from './outliner/TaskListItemExtension.jsx'
import {
  moveNodeInOutline,
  extractTitle,
  extractDates
} from './outliner/outlineManipulation.js'

const EnterHighPriority = Extension.create({
  name: 'enterHighPriority',
  priority: 1000,
  addOptions() {
    return {
      onEnter: null
    }
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor, event }) => {
        if (typeof this.options.onEnter === 'function') {
          return this.options.onEnter({ editor, event })
        }
        return false
      }
    }
  }
})

export default function OutlinerView({
  onSaveStateChange = () => {},
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
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const slashHandlersRef = useRef({ handleKeyDown: () => false, openAt: () => {} })
  const [imagePreview, setImagePreview] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => loadStatusFilter())
  const [showArchived, setShowArchived] = useState(() => loadArchivedVisible())
  const [tagFilters, setTagFilters] = useState(() => loadTagFilters())
  const [includeTagInput, setIncludeTagInput] = useState('')
  const [excludeTagInput, setExcludeTagInput] = useState('')
  const showArchivedRef = useRef(showArchived)
  const statusFilterRef = useRef(statusFilter)
  const tagFiltersRef = useRef(tagFilters)
  const includeInputRef = useRef(null)
  const excludeInputRef = useRef(null)
  const restoredScrollRef = useRef(false)
  const scrollSaveFrameRef = useRef(null)
  const filterScheduleRef = useRef(null)
  const lastFilterRunAtRef = useRef(0)
  const filterRunCounterRef = useRef(0)
  const [focusRootId, setFocusRootId] = useState(() => {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get('focus')
    } catch {
      return null
    }
  })
  const focusRootRef = useRef(focusRootId)
  useEffect(() => { focusRootRef.current = focusRootId }, [focusRootId])
  const [focusTitle, setFocusTitle] = useState('')
  const suppressUrlSyncRef = useRef(false)
  const initialFocusSyncRef = useRef(true)
  const pendingFocusScrollRef = useRef(null)
  useFocusShortcut()
  const activeTaskInfoRef = useRef(null)
  const lastFocusTokenRef = useRef(null)

  // Persist filters in localStorage
  useEffect(() => { saveStatusFilter(statusFilter) }, [statusFilter])
  useEffect(() => { saveArchivedVisible(showArchived) }, [showArchived])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  const draggingRef = useRef(null)
  const convertingImagesRef = useRef(false)
  const pendingEmptyCaretRef = useRef(false)

  const pendingImageSrcRef = useRef(new Set())
  const includeFilterList = Array.isArray(tagFilters?.include) ? tagFilters.include : []
  const excludeFilterList = Array.isArray(tagFilters?.exclude) ? tagFilters.exclude : []

  const onStatusToggleStable = useCallback((...args) => {
    if (typeof onStatusToggle === 'function') {
      return onStatusToggle(...args)
    }
    return undefined
  }, [onStatusToggle])

  const taskListItemExtension = useMemo(
    () => createTaskListItemExtension({
      readOnly: isReadOnly,
      draggingState: draggingRef,
      allowStatusToggleInReadOnly,
      onStatusToggle: onStatusToggleStable,
      reminderActionsEnabled
    }),
    [isReadOnly, draggingRef, allowStatusToggleInReadOnly, onStatusToggleStable, reminderActionsEnabled]
  )

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  const pushDebug = useCallback(() => {}, [])

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

  const enterHighPriority = useMemo(() => EnterHighPriority.configure({
    onEnter: ({ editor, event }) => {
      if (!editor || !event) return false
      return handleEnterKey({
        event,
        editor,
        now,
        logCursorTiming,
        pushDebug,
        pendingEmptyCaretRef
      })
    }
  }), [pushDebug, pendingEmptyCaretRef])

  const extensions = useMemo(() => [
    enterHighPriority,
    StarterKit.configure({ listItem: false, codeBlock: false }),
    taskListItemExtension,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    imageExtension,
    CodeBlockWithCopy,
    WorkDateHighlighter,
    ReminderTokenInline,
    DetailsBlock
  ], [enterHighPriority, taskListItemExtension, CodeBlockWithCopy, imageExtension])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__OUTLINER_EXTENSIONS = extensions.map((ext) => ext?.name || null)
    }
  }, [extensions])

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
    editorProps: {
      handleTextInput(view, from, to, text) {
        if (isReadOnly) return false
        if (text === '/') {
          pushDebug('handleTextInput " / " passthrough', { from, to })
          return false
        }
        return false
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          if (isReadOnly) return false
          const e = event
          if (e && e.inputType === 'insertText' && e.data === '/') {
            pushDebug('beforeinput passthrough for " / "')
            return false
          }
          return false
        },
        keypress: (view, event) => {
          if (isReadOnly) return false
          if (event.key === '/') {
            pushDebug('keypress passthrough for " / "')
            return false
          }
          return false
        },
        input: (view, event) => {
          if (isReadOnly) return false
          const data = event.data || ''
          if (data === '/') {
            pushDebug('input passthrough for " / "')
            return false
          }
          return false
        }
      },
      handlePaste(view, event) {
        if (isReadOnly) return false
        return handlePaste(view, event, editor, markDirty, saveTimer, doSave, pushDebug)
      },
      handleKeyDown(view, event) {
        if (isReadOnly) return false
        return handleKeyDown(
          view,
          event,
          slashHandlersRef,
          focusRootRef,
          pendingFocusScrollRef,
          setFocusRootId,
          computeActiveTask,
          onRequestTimelineFocus,
          editor,
          pendingEmptyCaretRef,
          pushDebug
        )
      }
    }
  })

  useEffect(() => {
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

  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  const ensureUploadedImagesCallback = useCallback(async () => {
    await ensureUploadedImages(editor, isReadOnly, convertingImagesRef, pendingImageSrcRef, normalizeImageSrc)
  }, [editor, isReadOnly, normalizeImageSrc])

  useEffect(() => {
    if (!editor || isReadOnly) return
    const handler = () => { ensureUploadedImagesCallback() }
    editor.on('update', handler)
    ensureUploadedImagesCallback()
    return () => {
      editor.off('update', handler)
    }
  }, [editor, isReadOnly, ensureUploadedImagesCallback])

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

  useEffect(() => {
    if (!editor || isReadOnly) return
    const { view } = editor
    const handleBeforeInput = (event) => {
      const pending = pendingEmptyCaretRef.current
      if (!pending) return
      if (!(event instanceof InputEvent)) return
      if (event.inputType && !event.inputType.startsWith('insert')) return
      pendingEmptyCaretRef.current = false
      if (pending && pending.type === 'caret' && typeof pending.pos === 'number') {
        const caretPos = pending.pos
        const { state: curState, view: curView } = editor
        try {
          const chainResult = editor?.chain?.().focus().setTextSelection({ from: caretPos, to: caretPos }).run()
          if (!chainResult) {
            const tr = curState.tr.setSelection(TextSelection.create(curState.doc, caretPos)).scrollIntoView()
            curView.dispatch(tr)
          }
          if (event.inputType === 'insertText' && typeof event.data === 'string' && event.data.length > 0) {
            event.preventDefault()
            editor?.chain?.().focus().insertContent(event.data).run()
          }
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[beforeinput caret] apply failed', error)
        }
      }
    }
    view.dom.addEventListener('beforeinput', handleBeforeInput, true)
    return () => {
      view.dom.removeEventListener('beforeinput', handleBeforeInput, true)
    }
  }, [editor, isReadOnly])

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
    openSlashAt
  } = useSlashCommands({ editor, isReadOnly, pushDebug })

  slashHandlersRef.current.handleKeyDown = slashHandleKeyDown
  slashHandlersRef.current.openAt = openSlashAt

  const saveTimer = useRef(null)
  const markDirty = () => {
    if (isReadOnly) return
    dirtyRef.current = true
    setDirty(true)
  }
  function queueSave(delay = 700) {
    if (isReadOnly) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(), delay)
  }

  const notifyOutlineSnapshot = useCallback((outline) => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('worklog:outline-snapshot', { detail: { outline } }))
    } catch (err) {
      console.error('[outline] notify snapshot failed', err)
    }
  }, [])

  const emitOutlineSnapshot = useCallback((outline) => {
    if (!broadcastSnapshots) return
    notifyOutlineSnapshot(outline)
  }, [broadcastSnapshots, notifyOutlineSnapshot])

  const applyCollapsedStateForRoot = useCollapsedStateApplier(editor, forceExpand, loadCollapsedSetForRoot)

  const availableFilters = AVAILABLE_FILTERS

  const toggleStatusFilter = (key) => {
    toggleStatusFilterUtil(statusFilter, key, setStatusFilter, statusFilterRef)
  }

  const applyPresetFilter = (preset) => {
    applyPresetFilterUtil(preset, setStatusFilter, statusFilterRef)
  }

  const addTagFilter = useCallback((mode, value) => {
    return addTagFilterUtil(mode, value, setTagFilters)
  }, [])

  const removeTagFilter = useCallback((mode, tag) => {
    return removeTagFilterUtil(mode, tag, setTagFilters)
  }, [])

  const clearTagFilters = useCallback(() => {
    clearTagFiltersUtil(setTagFilters, setIncludeTagInput, setExcludeTagInput)
  }, [])

  const handleTagInputChange = useCallback((mode) => (event) => {
    handleTagInputChangeUtil(mode, event, setIncludeTagInput, setExcludeTagInput)
  }, [])

  const handleTagInputKeyDown = useCallback((mode) => (event) => {
    handleTagInputKeyDownUtil(
      mode,
      event,
      addTagFilter,
      removeTagFilter,
      setIncludeTagInput,
      setExcludeTagInput,
      tagFiltersRef
    )
  }, [addTagFilter, removeTagFilter])

  const handleTagInputBlur = useCallback((mode) => (event) => {
    handleTagInputBlurUtil(
      mode,
      event,
      addTagFilter,
      setIncludeTagInput,
      setExcludeTagInput
    )
  }, [addTagFilter])

  const applyStatusFilter = useCallback(() => {
    applyStatusFilterUtil(
      editor,
      statusFilterRef,
      showArchivedRef,
      tagFiltersRef,
      focusRootRef
    )
  }, [editor, statusFilter, showArchived, tagFilters])

  const { scheduleApplyStatusFilter } = useFilterScheduler(
    applyStatusFilter,
    filterScheduleRef,
    lastFilterRunAtRef,
    filterRunCounterRef
  )



  const computeActiveTask = useCallback(() => {
    return computeActiveTaskUtil(editor)
  }, [editor])

  useActiveTaskNotifier(editor, computeActiveTask, onActiveTaskChange, activeTaskInfoRef)

  useEffect(() => {
    tagFiltersRef.current = tagFilters
    saveTagFilters(tagFilters)
    applyStatusFilter()
  }, [tagFilters, applyStatusFilter])

  const handleRequestFocus = useCallback((taskId) => {
    handleRequestFocusUtil(taskId, (val) => { pendingFocusScrollRef.current = val }, setFocusRootId)
  }, [])

  const focusTaskById = useCallback((taskId, { select = true } = {}) => {
    const result = focusTaskByIdUtil(editor, taskId, { select }, forceExpand, focusRootRef)
    if (result) {
      scheduleApplyStatusFilter('focusTaskById')
    }
    return result
  }, [editor, forceExpand, scheduleApplyStatusFilter])

  const requestFocusRef = useRef(handleRequestFocus)
  useEffect(() => { requestFocusRef.current = handleRequestFocus }, [handleRequestFocus])

  useEffect(() => {
    if (!focusRequest || !focusRequest.taskId || !editor) return undefined
    const token = focusRequest.token ?? `${focusRequest.taskId}:${focusRequest.remindAt ?? ''}`
    if (lastFocusTokenRef.current === token) return undefined
    lastFocusTokenRef.current = token
    const success = focusTaskById(focusRequest.taskId, { select: focusRequest.select !== false })
    if (success) {
      const info = computeActiveTask()
      activeTaskInfoRef.current = info
    }
    onFocusHandled?.(success)
  }, [focusRequest, editor, focusTaskById, onFocusHandled, computeActiveTask])

  useModifierClickFocus(requestFocusRef)

  const exitFocus = useCallback(() => {
    const currentId = focusRootRef.current
    if (!currentId) return
    // After we leave focus, scroll back to this task in the full outline
    pendingFocusScrollRef.current = String(currentId)
    exitFocusUtil(setFocusRootId, suppressUrlSyncRef)
  }, [])

  // Keyboard shortcuts to exit focus: Esc and Cmd+[
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!focusRootRef.current) return // only when actually focused

      const t = e.target
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inField && e.key !== 'Escape') return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        exitFocus()
        return
      }
      if (e.key === '[' && e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        exitFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [exitFocus])

  useFocusUrlSync(
    focusRootId,
    setFocusRootId,
    readFocusFromLocation,
    suppressUrlSyncRef,
    initialFocusSyncRef
  )

  const updateFocusTitle = useCallback(() => {
    updateFocusTitleUtil(focusRootRef.current, editor, extractTitle, setFocusTitle)
  }, [editor])

  useEffect(() => {
    applyStatusFilter()
  }, [applyStatusFilter])
  // Observe DOM changes to ensure filters apply when NodeViews finish mounting (first load, etc.)
  useDomMutationObserver(editor, scheduleApplyStatusFilter, filterScheduleRef, lastFilterRunAtRef)


  useEffect(() => {
    if (!editor || isReadOnly) return
    const dom = editor.view.dom
    const dragOverHandler = (event) => handleDragOver(event, draggingRef)
    const dropHandler = (event) => handleDrop(
      event,
      draggingRef,
      dom,
      parseOutline,
      moveNodeInOutline,
      buildList,
      editor,
      markDirty,
      queueSave,
      applyStatusFilter
    )
    dom.addEventListener('dragover', dragOverHandler)
    dom.addEventListener('drop', dropHandler)
    return () => {
      dom.removeEventListener('dragover', dragOverHandler)
      dom.removeEventListener('drop', dropHandler)
    }
  }, [editor, applyStatusFilter, isReadOnly])

  async function doSave() {
    await doSaveUtil({
      editor,
      isReadOnly,
      savingRef,
      setSaving,
      dirtyRef,
      setDirty,
      parseOutline,
      emitOutlineSnapshot,
      pushDebug,
      focusRootRef,
      suppressUrlSyncRef,
      setFocusRootId,
      queueSave
    })
  }

  useEffect(() => {
    if (!editor || !isReadOnly) return
    if (!initialOutline) return
    const roots = Array.isArray(initialOutline?.roots)
      ? initialOutline.roots
      : Array.isArray(initialOutline)
        ? initialOutline
        : (initialOutline?.roots || [])
    const cleanRoots = stripHighlightMarksFromOutlineNodes(roots)
    const doc = { type: 'doc', content: [buildList(cleanRoots)] }
    const cleanDoc = stripHighlightMarksFromDoc(doc)
    editor.commands.setContent(cleanDoc)
    dirtyRef.current = false
    setDirty(false)
    applyStatusFilter()
    emitOutlineSnapshot(cleanRoots)
  }, [editor, initialOutline, isReadOnly, applyStatusFilter, emitOutlineSnapshot])


  useCopyHandler(editor, pushDebug)

  useScrollStateSaver(editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef)

  const loadOutlineFromServer = useCallback(async () => {
    if (!editor || isReadOnly) return
    try {
      const data = await getOutline()
      const rawRoots = data.roots || []
      const roots = stripHighlightMarksFromOutlineNodes(rawRoots)
      const doc = { type: 'doc', content: [buildList(roots)] }
      const cleanDoc = stripHighlightMarksFromDoc(doc)
      editor.commands.setContent(cleanDoc)
      dirtyRef.current = false
      setDirty(false)
      pushDebug('loaded outline', { roots: roots.length })
      applyCollapsedStateForRoot(focusRootRef.current)
      scheduleApplyStatusFilter('initial-outline-load')
      restoredScrollRef.current = false
      setTimeout(() => {
        if (restoredScrollRef.current) {
          return
        }
        const state = loadScrollState()
        if (state && typeof state.topTaskId === 'string' && state.topTaskId) {
          const topTaskId = state.topTaskId
          const expectedOffset = Number.isFinite(state.topTaskOffset) ? state.topTaskOffset : 0
          const maxAttempts = 6
          const tolerance = 12
          const attemptRestore = (attempt = 0) => {
            if (restoredScrollRef.current) return
            if (!editor || !editor.view || !editor.view.dom) {
              if (attempt + 1 < maxAttempts) {
                requestAnimationFrame(() => attemptRestore(attempt + 1))
                return
              }
              restoredScrollRef.current = true
              return
            }
            let targetEl = null
            try {
              targetEl = editor.view.dom.querySelector(`li.li-node[data-id="${cssEscape(String(topTaskId))}"]`)
            } catch (err) {
              targetEl = null
            }
            if (!targetEl) {
              if (attempt + 1 < maxAttempts) {
                requestAnimationFrame(() => attemptRestore(attempt + 1))
                return
              }
              restoredScrollRef.current = true
              return
            }

            const rect = targetEl.getBoundingClientRect()
            if (!rect || !Number.isFinite(rect.top)) {
              if (attempt + 1 < maxAttempts) {
                requestAnimationFrame(() => attemptRestore(attempt + 1))
                return
              }
              restoredScrollRef.current = true
              return
            }

            const absoluteTop = rect.top + window.scrollY
            const desired = Math.max(0, absoluteTop - expectedOffset)
            pushDebug('restoring scroll anchor', { attempt, topTaskId, desired, expectedOffset })
            window.scrollTo({ top: desired, behavior: 'auto' })

            requestAnimationFrame(() => {
              const updatedRect = targetEl.getBoundingClientRect()
              const actualOffset = updatedRect && Number.isFinite(updatedRect.top) ? updatedRect.top : null
              const diff = (actualOffset === null || !Number.isFinite(expectedOffset))
                ? null
                : Math.abs(actualOffset - expectedOffset)
              const meta = { attempt, topTaskId, actualOffset, diff, expectedOffset }
              if (diff !== null && diff > tolerance && attempt + 1 < maxAttempts) {
                requestAnimationFrame(() => attemptRestore(attempt + 1))
                return
              }
              restoredScrollRef.current = true
            })
          }

          attemptRestore(0)
        } else {
          pushDebug('no scroll state to restore', { state })
          restoredScrollRef.current = true
        }
      }, 120)
    } catch (err) {
      console.error('[outline] failed to load outline', err)
    }
  }, [editor, isReadOnly, applyCollapsedStateForRoot, focusRootRef, scheduleApplyStatusFilter, restoredScrollRef, pushDebug])

  useEffect(() => {
    if (!editor || isReadOnly) return
    loadOutlineFromServer()
  }, [editor, isReadOnly, loadOutlineFromServer])

  useEffect(() => {
    if (!editor || isReadOnly) return () => {}
    if (typeof window === 'undefined') return () => {}
    const cancelPendingRestore = () => {
      restoredScrollRef.current = true
    }
    window.addEventListener('pointerdown', cancelPendingRestore, { capture: true })
    window.addEventListener('wheel', cancelPendingRestore, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', cancelPendingRestore, { capture: true })
      window.removeEventListener('wheel', cancelPendingRestore)
    }
  }, [editor, isReadOnly, restoredScrollRef])

  useEffect(() => {
    if (isReadOnly) return
    const handler = () => queueSave(0)
    window.addEventListener('worklog:request-save', handler)
    return () => window.removeEventListener('worklog:request-save', handler)
  }, [isReadOnly])

  useTaskStatusSync(editor, scheduleApplyStatusFilter)



  function buildList(nodes) {
    return buildListUtil(nodes, forceExpand, normalizeImageSrc)
  }

  function parseOutline() {
    return parseOutlineUtil(editor, extractTitle, extractDates, normalizeBodyNodes, pushDebug)
  }

  const { applyReminderAction } = useReminderActions({
    editor,
    markDirty,
    queueSave,
    parseOutline,
    emitOutlineSnapshot
  })

  useReminderActionListener(editor, applyReminderAction)

  useFocusModeBodyClass(focusRootId)

  useEffect(() => {
    applyCollapsedStateForRoot(focusRootId)
    applyStatusFilter()
  }, [focusRootId, applyCollapsedStateForRoot, applyStatusFilter])

  useFocusRootScroll(focusRootId, editor, pendingFocusScrollRef)

  useFocusTitleUpdater(editor, updateFocusTitle)

  useEffect(() => {
    updateFocusTitle()
  }, [focusRootId, updateFocusTitle])

  const focusDisplayTitle = focusTitle?.trim() ? focusTitle.trim() : 'Untitled task'
  const focusContextValue = useMemo(() => ({
    focusRootId,
    requestFocus: handleRequestFocus,
    exitFocus,
    loadCollapsedSet: loadCollapsedSetForRoot,
    saveCollapsedSet: saveCollapsedSetForRoot,
    forceExpand
  }), [focusRootId, handleRequestFocus, exitFocus, forceExpand])

  return (
    <div style={{ position:'relative' }}>
      {!isReadOnly && (
        <FilterBar
            availableFilters={availableFilters}
            statusFilter={statusFilter}
            toggleStatusFilter={toggleStatusFilter}
            applyPresetFilter={applyPresetFilter}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            showArchivedRef={showArchivedRef}
            saveArchivedVisible={saveArchivedVisible}
            includeFilterList={includeFilterList}
            removeTagFilter={removeTagFilter}
            includeInputRef={includeInputRef}
            includeTagInput={includeTagInput}
            handleTagInputChange={handleTagInputChange}
            handleTagInputKeyDown={handleTagInputKeyDown}
            handleTagInputBlur={handleTagInputBlur}
            excludeFilterList={excludeFilterList}
            excludeInputRef={excludeInputRef}
            excludeTagInput={excludeTagInput}
            clearTagFilters={clearTagFilters}
            extraControls={(
              <ExportImportControls onImportComplete={loadOutlineFromServer} />
            )}
          />
      )}
      {focusRootId && (
        <div className="focus-banner">
          <div className="focus-banner-label">
            Viewing focus
            <span className="focus-banner-title">{focusDisplayTitle}</span>
          </div>
          <button className="btn ghost" type="button" onClick={exitFocus}>Exit focus</button>
        </div>
      )}
      <FocusContext.Provider value={focusContextValue}>
        <EditorContent editor={editor} className="tiptap" />
      </FocusContext.Provider>
      {imagePreview && (
        <div className="overlay" onClick={() => setImagePreview(null)}>
          <div className="image-modal" onClick={e => e.stopPropagation()}>
            <img src={imagePreview} alt="Preview" />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setImagePreview(null)}>Close</button>
          </div>
        </div>
      )}
      {slashOpen && (
        <SlashMenu
          menuRef={menuRef}
          slashPos={slashPos}
          slashQuery={slashQuery}
          setSlashQuery={setSlashQuery}
          updateSlashActive={updateSlashActive}
          filteredCommands={filteredCommands}
          slashActiveIndex={slashActiveIndex}
          closeSlash={closeSlash}
          slashInputRef={slashInputRef}
        />
      )}
      {datePickerOpen && (
        <div className="date-picker-pop" style={{ left: slashPos.x, top: slashPos.y }} role="dialog" aria-modal="true">
          <div className="date-picker-title">Pick a date</div>
          <input
            type="date"
            defaultValue={datePickerValueRef.current}
            onChange={(e) => { datePickerValueRef.current = e.target.value }}
          />
          <div className="date-picker-actions">
            <button className="btn" type="button" onClick={applyPickedDate}>Insert</button>
            <button className="btn ghost" type="button" onClick={() => setDatePickerOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

    </div>
  )
}
