
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
import { TagHighlighter } from '../extensions/tagHighlighter.js'
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
  saveTagFilters,
  DEFAULT_STATUS_FILTER,
  DEFAULT_TAG_FILTER
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
  filtersDisabled = false,
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
  // --- Link menu state ---
  const [linkMenu, setLinkMenu] = useState({
    open: false,
    href: '',
    x: 0,
    y: 0,
    range: null
  })
  const [linkCopied, setLinkCopied] = useState(false)
  const linkMenuRef = useRef(null)
  const [statusFilter, setStatusFilter] = useState(() => (
    filtersDisabled
      ? { ...DEFAULT_STATUS_FILTER }
      : loadStatusFilter()
  ))
  const [showArchived, setShowArchived] = useState(() => (
    filtersDisabled
      ? true
      : loadArchivedVisible()
  ))
  const [tagFilters, setTagFilters] = useState(() => {
    if (filtersDisabled) {
      return {
        include: [...(DEFAULT_TAG_FILTER.include || [])],
        exclude: [...(DEFAULT_TAG_FILTER.exclude || [])]
      }
    }
    return loadTagFilters()
  })
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
  useEffect(() => {
    if (filtersDisabled) return
    saveStatusFilter(statusFilter)
  }, [statusFilter, filtersDisabled])
  useEffect(() => {
    if (filtersDisabled) return
    saveArchivedVisible(showArchived)
  }, [showArchived, filtersDisabled])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  const draggingRef = useRef(null)
  const convertingImagesRef = useRef(false)
  const pendingEmptyCaretRef = useRef(false)

  const pendingImageSrcRef = useRef(new Set())
  const includeFilterList = Array.isArray(tagFilters?.include) ? tagFilters.include : []
  const excludeFilterList = Array.isArray(tagFilters?.exclude) ? tagFilters.exclude : []

  useEffect(() => {
    if (!linkMenu.open) return
    const onDocMouseDown = (e) => {
      if (linkMenuRef.current && !linkMenuRef.current.contains(e.target)) {
        setLinkMenu((m) => ({ ...m, open: false }))
        setLinkCopied(false)
      }
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setLinkMenu((m) => ({ ...m, open: false }))
        setLinkCopied(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [linkMenu.open])

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
    TagHighlighter,
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
        },
        click: (view, event) => {
          const target = event.target
          if (!target) return false

          const anchor = target.closest && target.closest('a[href]')
          if (!anchor) return false

          event.preventDefault()
          event.stopPropagation()

          const href = anchor.getAttribute('href') || ''

          const posInfo = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (posInfo && typeof posInfo.pos === 'number' && editor) {
            editor
              .chain()
              .setTextSelection({ from: posInfo.pos, to: posInfo.pos })
              .extendMarkRange('link')
              .run()
          }

          if (!editor) return false

          const { from, to } = editor.state.selection
          const attrsHref = editor.getAttributes('link')?.href
          const effectiveHref = attrsHref || href

          setLinkMenu({
            open: true,
            href: effectiveHref || '',
            x: event.clientX + 8,
            y: event.clientY + 12,
            range: { from, to }
          })
          setLinkCopied(false)

          return true
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

  const slash = useSlashCommands({ editor, isReadOnly, pushDebug })
  const { handleKeyDown: slashHandleKeyDown, openSlashAt } = slash

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

  const closeLinkMenu = () => setLinkMenu((m) => ({ ...m, open: false }))

  const removeLink = () => {
    if (isReadOnly || !linkMenu.range || !editor) return
    editor
      .chain()
      .focus()
      .setTextSelection(linkMenu.range)
      .unsetLink()
      .run()
    closeLinkMenu()
  }

  const openLinkInNewTab = () => {
    if (!linkMenu.href) return
    if (typeof window === 'undefined') return
    window.open(linkMenu.href, '_blank', 'noopener,noreferrer')
    closeLinkMenu()
  }

  const copyLink = async () => {
    if (!linkMenu.href) return
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
      if (clipboard?.writeText) {
        await clipboard.writeText(linkMenu.href)
      } else {
        throw new Error('Clipboard API unavailable')
      }
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1200)
    } catch {
      if (typeof document === 'undefined') return
      const el = document.createElement('textarea')
      el.value = linkMenu.href
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.top = '-1000px'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1200)
    }
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
    if (filtersDisabled) return
    applyStatusFilterUtil(
      editor,
      statusFilterRef,
      showArchivedRef,
      tagFiltersRef,
      focusRootRef
    )
  }, [editor, filtersDisabled, statusFilter, showArchived, tagFilters])

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
    if (filtersDisabled) return
    saveTagFilters(tagFilters)
    applyStatusFilter()
  }, [tagFilters, applyStatusFilter, filtersDisabled])

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
            const scheduleRetry = () => {
              if (attempt + 1 < maxAttempts) {
                requestAnimationFrame(() => attemptRestore(attempt + 1))
                return true
              }
              restoredScrollRef.current = true
              return false
            }
            if (!editor || !editor.view || !editor.view.dom) {
              scheduleRetry()
              return
            }
            let targetEl = null
            try {
              targetEl = editor.view.dom.querySelector(`li.li-node[data-id="${cssEscape(String(topTaskId))}"]`)
            } catch (err) {
              targetEl = null
            }
            if (!targetEl) {
              scheduleRetry()
              return
            }

            const rect = targetEl.getBoundingClientRect()
            if (!rect || !Number.isFinite(rect.top)) {
              scheduleRetry()
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
              if (diff !== null && diff > tolerance) {
                if (scheduleRetry()) return
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
      {linkMenu.open && (
        <div
          ref={linkMenuRef}
          className="slash-menu"
          style={{ left: linkMenu.x, top: linkMenu.y }}
          role="menu"
          aria-label="Link options"
        >
          <button
            type="button"
            onClick={removeLink}
            disabled={isReadOnly}
            title={isReadOnly ? 'Read-only' : 'Remove the link'}
          >
            <span className="cmd-label">Remove link</span>
            <span className="cmd-hint">Unset the link mark</span>
          </button>

          <button type="button" onClick={openLinkInNewTab}>
            <span className="cmd-label">Open link in new tab</span>
            <span className="cmd-hint">{linkMenu.href}</span>
          </button>

          <button type="button" onClick={copyLink}>
            <span className="cmd-label">{linkCopied ? 'Copied!' : 'Copy link'}</span>
            <span className="cmd-hint">{linkMenu.href}</span>
          </button>
        </div>
      )}
      {imagePreview && (
        <div className="overlay" onClick={() => setImagePreview(null)}>
          <div className="image-modal" onClick={e => e.stopPropagation()}>
            <img src={imagePreview} alt="Preview" />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setImagePreview(null)}>Close</button>
          </div>
        </div>
      )}
      {slash.slashOpen && (
        <SlashMenu
          menuRef={slash.menuRef}
          slashPos={slash.slashPos}
          slashQuery={slash.slashQuery}
          setSlashQuery={slash.setSlashQuery}
          updateSlashActive={slash.updateSlashActive}
          filteredCommands={slash.filteredCommands}
          slashActiveIndex={slash.slashActiveIndex}
          closeSlash={slash.closeSlash}
          slashInputRef={slash.slashInputRef}
        />
      )}
      {slash.datePickerOpen && (
        <div className="date-picker-pop" style={{ left: slash.slashPos.x, top: slash.slashPos.y }} role="dialog" aria-modal="true">
          <div className="date-picker-title">Pick a date</div>
          <input
            type="date"
            defaultValue={slash.datePickerValueRef.current}
            onChange={(e) => { slash.datePickerValueRef.current = e.target.value }}
          />
          <div className="date-picker-actions">
            <button className="btn" type="button" onClick={slash.applyPickedDate}>Insert</button>
            <button className="btn ghost" type="button" onClick={() => slash.setDatePickerOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

    </div>
  )
}
