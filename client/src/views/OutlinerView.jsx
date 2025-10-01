import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ImageWithMeta } from '../extensions/imageWithMeta.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { lowlight } from 'lowlight/lib/core.js'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { API_ROOT, absoluteUrl, getOutline, saveOutlineApi, uploadImage } from '../api.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'
import { WorkDateHighlighter } from '../extensions/workDateHighlighter'
import { ReminderTokenInline } from '../extensions/reminderTokenInline.js'
import { DetailsBlock } from '../extensions/detailsBlock.jsx'
import { safeReactNodeViewRenderer } from '../tiptap/safeReactNodeViewRenderer.js'
import { useSlashCommands } from './outliner/useSlashCommands.js'
import { useReminderActions } from './outliner/useReminderActions.js'
import { useOutlineFilters } from './outliner/useOutlineFilters.js'
import { useOutlineSearch } from './outliner/useOutlineSearch.js'
import { useOutlineSaving } from './outliner/useOutlineSaving.js'
import { FocusContext, focusContextDefaults } from './outliner/FocusContext.js'
import {
  STATUS_EMPTY,
  STATUS_ORDER,
  STATUS_ICON,
  DATE_RE,
  COLLAPSED_KEY,
  SCROLL_STATE_KEY,
  STARTER_PLACEHOLDER_TITLE
} from './outliner/constants.js'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './outliner/collapsedState.js'
import {
  DEFAULT_STATUS_FILTER,
  DEFAULT_TAG_FILTER,
  loadScrollState
} from './outliner/filterPreferences.js'
import {
  reminderIsDue,
  computeReminderDisplay,
  stripReminderDisplayBreaks
} from '../utils/reminderTokens.js'
import {
  extractOutlineClipboardPayload,
  prepareClipboardData
} from '../utils/outlineClipboard.js'
import { sanitizeNodeImages } from '../utils/imageFallback.js'
import { isLikelyUrl, normalizeUrl, escapeForRegex } from './outliner/urlUtils.js'
import { CodeBlockView } from './outliner/CodeBlockView.jsx'
import { createTaskListItemExtension } from './outliner/TaskListItemExtension.jsx'
import {
  buildOutlineList,
  parseOutlineFromEditor,
  moveNodeInOutline
} from './outliner/outlineSerialization.js'
import { applyStatusFilterDom } from './outliner/statusFilterDom.js'
import { useOutlinerFocus } from './outliner/useOutlinerFocus.js'
import { handleEditorKeyDown } from './outliner/editorKeyBindings.js'
import { FilterControls } from './outliner/FilterControls.jsx'


const LOG_ON = () => (localStorage.getItem('WL_DEBUG') === '1')
const LOG = (...args) => { if (LOG_ON()) console.log('[slash]', ...args) }

const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\-_]/g, (match) => `\${match}`)
}

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

  const {
    showFuture,
    toggleShowFuture,
    showFutureRef,
    showSoon,
    toggleShowSoon,
    showSoonRef,
    showArchived,
    toggleShowArchived,
    showArchivedRef,
    statusFilter,
    setStatusFilter,
    statusFilterRef,
    tagFilters,
    tagFiltersRef,
    includeTagInput,
    excludeTagInput,
    addTagFilter,
    removeTagFilter,
    clearTagFilters,
    handleTagInputChange,
    handleTagInputKeyDown,
    handleTagInputBlur
  } = useOutlineFilters()
  const [imagePreview, setImagePreview] = useState(null)
  const applyStatusFilterRef = useRef(null)
  const includeInputRef = useRef(null)
  const excludeInputRef = useRef(null)
  const restoredScrollRef = useRef(false)
  const scrollSaveFrameRef = useRef(null)
  const filterScheduleRef = useRef(null)
  const lastFilterRunAtRef = useRef(0)
  const filterRunCounterRef = useRef(0)
  const scheduleApplyStatusFilterRef = useRef(() => {})
  const focusRootRef = useRef(null)
  const focusRootSetterRef = useRef(null)

  const draggingRef = useRef(null)
  const convertingImagesRef = useRef(false)
  const suppressSelectionRestoreRef = useRef(false)
  const pendingEmptyCaretRef = useRef(false)

  const pendingImageSrcRef = useRef(new Set())
  const includeFilterList = Array.isArray(tagFilters?.include) ? tagFilters.include : []
  const excludeFilterList = Array.isArray(tagFilters?.exclude) ? tagFilters.exclude : []
  const hasTagFilters = includeFilterList.length > 0 || excludeFilterList.length > 0

  const markDirtyRef = useRef(() => {})
  const queueSaveRef = useRef(() => {})
  const cancelSaveRef = useRef(() => {})
  const doSaveRef = useRef(() => {})

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

  const taskListItemExtension = useMemo(
    () => createTaskListItemExtension({
      readOnly: isReadOnly,
      draggingState: draggingRef,
      allowStatusToggleInReadOnly,
      onStatusToggle,
      reminderActionsEnabled
    }),
    [isReadOnly, draggingRef, allowStatusToggleInReadOnly, onStatusToggle, reminderActionsEnabled]
  )

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])

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

  const editor = useEditor({
    // disable default codeBlock to avoid duplicate name with CodeBlockLowlight
    extensions,
    content: '<p>Loading…</p>',
    autofocus: false,
    editable: !isReadOnly,
    onCreate: () => { pushDebug('editor: ready'); scheduleApplyStatusFilter('editor.onCreate') },
    onUpdate: () => {
      if (!isReadOnly) {
        markDirtyRef.current()
        queueSaveRef.current()
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
        const { state } = view
        const result = extractOutlineClipboardPayload({
          clipboardData: event.clipboardData,
          schema: state.schema
        })

        if (result?.error) {
          console.error('[paste] failed to decode outline slice', result.error)
        }

        if (result?.payload) {
          event.preventDefault()
          if (result.payload.kind === 'doc') {
            editor?.commands?.setContent(result.payload.doc, true)
            markDirtyRef.current()
            cancelSaveRef.current()
            void doSaveRef.current()
            pushDebug('paste: outline doc restored (legacy)')
            return true
          }
          if (result.payload.kind === 'slice') {
            const slice = result.payload.slice
            const tr = state.tr.replaceSelection(slice).scrollIntoView()
            view.dispatch(tr)
            view.focus()
            markDirtyRef.current()
            cancelSaveRef.current()
            void doSaveRef.current()
            pushDebug('paste: outline slice inserted', { openStart: slice.openStart, openEnd: slice.openEnd })
            return true
          }
        }
        // 2) Smart-link paste when the clipboard is a single URL and there is a selection
        const text = event.clipboardData?.getData('text/plain') || ''
        const trimmed = text.trim()
        if (!trimmed || !isLikelyUrl(trimmed)) return false
        if (view.state.selection.empty) return false
        event.preventDefault()
        const href = normalizeUrl(trimmed)
        editor?.chain().focus().setLink({ href }).run()
        pushDebug('paste: link applied', { href })
        return true
      },
      handleKeyDown(view, event) {
        return handleEditorKeyDown({
          editor,
          view,
          event,
          isReadOnly,
          slashHandlersRef,
          focusRootRef,
          pendingFocusScrollRef,
          pendingEmptyCaretRef,
          suppressSelectionRestoreRef,
          setFocusRootId,
          computeActiveTask,
          onRequestTimelineFocus,
          pushDebug,
          scheduleApplyStatusFilter: (reason) => scheduleApplyStatusFilterRef.current(reason),
          logCursorTiming
        })
      }
    }
  })

  const {
    searchQuery,
    handleSearchChange,
    handleSearchClear
  } = useOutlineSearch({
    editor,
    escapeForRegex,
    suppressSelectionRestoreRef
  })

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

  const {
    focusRootId,
    setFocusRootId,
    focusContextValue,
    focusDisplayTitle,
    handleRequestFocus,
    focusTaskById,
    exitFocus,
    computeActiveTask,
    activeTaskInfoRef,
    pendingFocusScrollRef,
    suppressUrlSyncRef
  } = useOutlinerFocus({
    editor,
    forceExpand,
    loadCollapsedSetForRoot,
    saveCollapsedSetForRoot,
    scheduleApplyStatusFilterRef,
    cssEscape,
    focusRequest,
    onFocusHandled,
    focusRootRef
  })

  useEffect(() => {
    focusRootSetterRef.current = setFocusRootId
  }, [setFocusRootId])

  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  const {
    dirty,
    saving,
    markDirty,
    queueSave,
    cancelPendingSave,
    doSave
  } = useOutlineSaving({
    editor,
    isReadOnly,
    normalizeImageSrc,
    emitOutlineSnapshot,
    focusRootRef,
    focusRootSetterRef,
    suppressUrlSyncRef,
    pushDebug
  })

  useEffect(() => {
    markDirtyRef.current = markDirty
  }, [markDirty])

  useEffect(() => {
    queueSaveRef.current = queueSave
  }, [queueSave])

  useEffect(() => {
    cancelSaveRef.current = cancelPendingSave
  }, [cancelPendingSave])

  useEffect(() => {
    doSaveRef.current = doSave
  }, [doSave])

  useEffect(() => {
    onSaveStateChange({ dirty, saving })
  }, [dirty, saving, onSaveStateChange])

  useEffect(() => {
    if (!editor) return
    if (typeof window === 'undefined') return
    window.__WORKLOG_EDITOR = editor
    if (!isReadOnly) window.__WORKLOG_EDITOR_MAIN = editor
    else window.__WORKLOG_EDITOR_RO = editor
    return () => {
      if (window.__WORKLOG_EDITOR === editor) window.__WORKLOG_EDITOR = null
      if (!isReadOnly && window.__WORKLOG_EDITOR_MAIN === editor) window.__WORKLOG_EDITOR_MAIN = null
      if (isReadOnly && window.__WORKLOG_EDITOR_RO === editor) window.__WORKLOG_EDITOR_RO = null
    }
  }, [editor, isReadOnly])

  const applyStatusFilter = useCallback(() => {
    if (!editor) return
    applyStatusFilterDom(editor.view.dom, {
      cssEscape,
      focusId: focusRootRef.current ? String(focusRootRef.current) : null,
      showArchived: showArchivedRef.current !== false,
      showFuture: showFutureRef.current !== false,
      showSoon: showSoonRef.current !== false,
      statusFilter: statusFilterRef.current || {},
      tagFilters: tagFiltersRef.current || DEFAULT_TAG_FILTER
    })
  }, [cssEscape, editor])

  const applyCollapsedStateForRoot = useCallback((rootId) => {
    if (!editor) return
    const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(rootId)
    const { state, view } = editor
    if (!state || !view) return
    let tr = state.tr
    let mutated = false
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return
      const dataId = node.attrs.dataId
      if (!dataId) return
      const shouldCollapse = collapsedSet.has(String(dataId))
      if (!!node.attrs.collapsed !== shouldCollapse) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: shouldCollapse })
        mutated = true
      }
    })
    if (mutated) {
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    }
  }, [editor, forceExpand, loadCollapsedSetForRoot])

  useEffect(() => { showFutureRef.current = showFuture }, [showFuture])
  useEffect(() => { showSoonRef.current = showSoon }, [showSoon])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])

  const cancelScheduledFilter = useCallback(() => {
    const handle = filterScheduleRef.current
    if (!handle) return
    filterScheduleRef.current = null
    if (handle.type === 'raf') {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle.id)
      }
    } else if (handle.type === 'timeout') {
      clearTimeout(handle.id)
    }
  }, [])

  const scheduleApplyStatusFilter = useCallback((reason = 'unknown') => {
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
    const runFilter = () => {
      filterScheduleRef.current = null
      filterRunCounterRef.current = filterRunCounterRef.current + 1
      try {
        applyStatusFilter()
      } finally {
        const end = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
        lastFilterRunAtRef.current = end
      }
    }

    cancelScheduledFilter()

    const scheduledAt = now
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => {
        runFilter()
      })
      filterScheduleRef.current = { type: 'raf', id: rafId, reason, scheduledAt }
    } else {
      const timeoutId = setTimeout(() => {
        runFilter()
      }, 16)
      filterScheduleRef.current = { type: 'timeout', id: timeoutId, reason, scheduledAt }
    }
  }, [applyStatusFilter, cancelScheduledFilter])

  useEffect(() => () => { cancelScheduledFilter() }, [cancelScheduledFilter])

  useEffect(() => {
    scheduleApplyStatusFilterRef.current = scheduleApplyStatusFilter
  }, [scheduleApplyStatusFilter])

  const availableFilters = useMemo(() => ([
    { key: 'none', label: 'No status' },
    { key: 'todo', label: 'To do' },
    { key: 'in-progress', label: 'In progress' },
    { key: 'done', label: 'Done' }
  ]), [])

  const statusFilterKeys = useMemo(() => Object.keys(DEFAULT_STATUS_FILTER), [])

  const commitStatusFilter = useCallback((next, reason) => {
    const current = statusFilterRef.current || DEFAULT_STATUS_FILTER
    const unchanged = statusFilterKeys.every((key) => Boolean(current[key]) === Boolean(next[key]))
    if (unchanged) return current
    statusFilterRef.current = next
    setStatusFilter(next)
    scheduleApplyStatusFilter(reason || 'status-update')
    return next
  }, [scheduleApplyStatusFilter, setStatusFilter, statusFilterKeys, statusFilterRef])

  const toggleStatusFilter = useCallback((key) => {
    const current = statusFilterRef.current || DEFAULT_STATUS_FILTER
    const updated = { ...current, [key]: !current[key] }
    const anyEnabled = statusFilterKeys.some((k) => updated[k])
    const next = anyEnabled ? updated : { ...DEFAULT_STATUS_FILTER, done: false }
    commitStatusFilter(next, `toggle-${key}`)
  }, [commitStatusFilter, statusFilterKeys, statusFilterRef])

  const applyPresetFilter = useCallback((preset) => {
    if (preset === 'all') {
      commitStatusFilter({ ...DEFAULT_STATUS_FILTER }, 'preset-all')
      return
    }
    if (preset === 'active') {
      commitStatusFilter({ none: true, todo: true, 'in-progress': true, done: false }, 'preset-active')
      return
    }
    if (preset === 'completed') {
      commitStatusFilter({ none: false, todo: false, 'in-progress': false, done: true }, 'preset-completed')
    }
  }, [commitStatusFilter])

  const handleToggleArchived = useCallback(() => {
    const next = toggleShowArchived()
    scheduleApplyStatusFilter(next ? 'toggle-archived-on' : 'toggle-archived-off')
  }, [toggleShowArchived, scheduleApplyStatusFilter])

  const handleToggleFuture = useCallback(() => {
    const next = toggleShowFuture()
    scheduleApplyStatusFilter(next ? 'toggle-future-on' : 'toggle-future-off')
  }, [toggleShowFuture, scheduleApplyStatusFilter])

  const handleToggleSoon = useCallback(() => {
    const next = toggleShowSoon()
    scheduleApplyStatusFilter(next ? 'toggle-soon-on' : 'toggle-soon-off')
    queueMicrotask(() => {
      try {
        if (next && editor?.view?.dom) {
          const root = editor.view.dom
          root.querySelectorAll('li.li-node[data-soon="1"]').forEach((li) => {
            li.classList.remove('filter-hidden')
            li.style.display = ''
          })
        }
        applyStatusFilterRef.current?.()
      } catch {}
    })
  }, [toggleShowSoon, scheduleApplyStatusFilter, editor])

  const includeChangeHandler = useMemo(() => handleTagInputChange('include'), [handleTagInputChange])
  const includeKeyDownHandler = useMemo(() => handleTagInputKeyDown('include'), [handleTagInputKeyDown])
  const includeBlurHandler = useMemo(() => handleTagInputBlur('include'), [handleTagInputBlur])

  const excludeChangeHandler = useMemo(() => handleTagInputChange('exclude'), [handleTagInputChange])
  const excludeKeyDownHandler = useMemo(() => handleTagInputKeyDown('exclude'), [handleTagInputKeyDown])
  const excludeBlurHandler = useMemo(() => handleTagInputBlur('exclude'), [handleTagInputBlur])

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

  useEffect(() => {
    if (!editor) return undefined
    const notify = () => {
      const info = computeActiveTask()
      const prev = activeTaskInfoRef.current
      const prevKey = prev ? `${prev.id}|${prev.hasReminder}|${prev.hasDate}|${prev.reminderDate}|${(prev.dates || []).join(',')}` : ''
      const nextKey = info ? `${info.id}|${info.hasReminder}|${info.hasDate}|${info.reminderDate}|${(info.dates || []).join(',')}` : ''
      if (prevKey === nextKey) return
      activeTaskInfoRef.current = info
      onActiveTaskChange?.(info)
    }
    notify()
    editor.on('selectionUpdate', notify)
    editor.on('transaction', notify)
    return () => {
      editor.off('selectionUpdate', notify)
      editor.off('transaction', notify)
    }
  }, [editor, computeActiveTask, onActiveTaskChange])

  useEffect(() => {
    tagFiltersRef.current = tagFilters
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

  useEffect(() => {
    if (!editor || isReadOnly) return
    const dom = editor.view.dom
    const handleDragOver = (event) => {
      if (!draggingRef.current) return

      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }
    const handleDrop = (event) => {
      const drag = draggingRef.current
      if (!drag) return
      event.preventDefault()
      const dragEl = drag.element
      const pointerY = event.clientY
      const dragList = dragEl ? dragEl.closest('ul') : null
      const candidates = Array.from(dom.querySelectorAll('li.li-node'))
        .filter(el => el !== dragEl && (!dragList || el.closest('ul') === dragList)) // only same-level siblings
      let chosen = null
      let dropAfter = false
      // Compute depth of an li by counting ancestor lis
      const getDepth = (el) => {
        let depth = 0; let cur = el.parentElement
        while (cur) { if (cur.matches && cur.matches('li.li-node')) depth += 1; cur = cur.parentElement }
        return depth
      }
      const infos = candidates.map(el => ({ el, rect: el.getBoundingClientRect(), depth: getDepth(el) }))
        .filter(info => info.rect.height > 0)
        .sort((a, b) => a.rect.top - b.rect.top)
      const inside = infos.filter(info => pointerY >= info.rect.top && pointerY <= info.rect.bottom)
      if (inside.length) {
        // Prefer deepest element under the pointer
        inside.sort((a, b) => b.depth - a.depth)
        const pick = inside[0]
        const mid = pick.rect.top + (pick.rect.height / 2)
        chosen = pick.el
        dropAfter = pointerY > mid
      } else {
        // Find first element below the pointer => drop before it
        const below = infos.find(info => pointerY < info.rect.top)
        if (below) {
          chosen = below.el
          dropAfter = false
        } else if (infos.length) {
          // Otherwise choose the last => drop after it
          chosen = infos[infos.length - 1].el
          dropAfter = true
        }
      }
      const targetId = chosen?.getAttribute('data-id') || null
      if (dragEl && chosen && dragEl.contains(chosen)) {
        console.log('[drop] aborted: target inside drag element', { dragId: drag.id, targetId })
        draggingRef.current = null
        return
      }
      const outline = parseOutline()
      console.log('[drop] request', {
        dragId: drag.id,
        targetId,
        dropAfter,
        pointerY,
        chosenBounds: chosen ? (() => { const rect = chosen.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2 } })() : null
      })
      const moved = moveNodeInOutline(outline, drag.id, targetId, dropAfter ? 'after' : 'before')
      draggingRef.current = null
      if (!moved) return
      console.log('[drop] move applied', { order: moved.map(n => n.id) })
      const docJSON = { type: 'doc', content: [buildList(moved)] }
      editor.commands.setContent(docJSON)
      markDirty()
      queueSave(300)
      applyStatusFilter()
    }
    dom.addEventListener('dragover', handleDragOver)
    dom.addEventListener('drop', handleDrop)
    return () => {
      dom.removeEventListener('dragover', handleDragOver)
      dom.removeEventListener('drop', handleDrop)
    }
  }, [editor, applyStatusFilter, isReadOnly])

  

  useEffect(() => {
    if (!editor || !isReadOnly) return
    if (!initialOutline) return
    const roots = Array.isArray(initialOutline?.roots)
      ? initialOutline.roots
      : Array.isArray(initialOutline)
        ? initialOutline
        : (initialOutline?.roots || [])
    const sanitizedRoots = sanitizeNodeImages(roots)
    const doc = { type: 'doc', content: [buildList(sanitizedRoots)] }
    editor.commands.setContent(doc)
    applyStatusFilter()
    emitOutlineSnapshot(sanitizedRoots)
  }, [editor, initialOutline, isReadOnly, applyStatusFilter, emitOutlineSnapshot])

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
      const doc = { type: 'doc', content: [buildList(roots)] }
      editor.commands.setContent(doc)
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

  const buildList = useCallback(
    (nodes) => buildOutlineList(nodes, {
      forceExpand,
      loadCollapsedSetForRoot,
      normalizeImageSrc
    }),
    [forceExpand, loadCollapsedSetForRoot, normalizeImageSrc]
  )

  const parseOutline = useCallback(() => (
    editor ? parseOutlineFromEditor(editor, normalizeImageSrc, pushDebug) : []
  ), [editor, normalizeImageSrc, pushDebug])

  const { applyReminderAction } = useReminderActions({
    editor,
    markDirty,
    queueSave,
    parseOutline,
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


  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    if (!body) return undefined
    const className = 'focus-mode'
    if (focusRootId) body.classList.add(className)
    else body.classList.remove(className)
    return () => {
      if (focusRootId) body.classList.remove(className)
    }
  }, [focusRootId])

  useEffect(() => {
    applyCollapsedStateForRoot(focusRootId)
    applyStatusFilter()
  }, [focusRootId, applyCollapsedStateForRoot, applyStatusFilter])

  useEffect(() => {
    if (!focusRootId) return
    if (!editor || !editor.view || !editor.view.dom) return
    const targetId = focusRootId
    const runScroll = () => {
      try {
        const rootEl = editor.view.dom
        let targetEl = null
        try {
          targetEl = rootEl.querySelector(`li.li-node[data-id="${cssEscape(String(targetId))}"]`)
        } catch {
          targetEl = null
        }
        if (!targetEl) return
        const rect = targetEl.getBoundingClientRect()
        const viewportHeight = window.innerHeight || 0
        const desired = Math.max(0, (rect.top + window.scrollY) - Math.max(0, (viewportHeight / 2) - (rect.height / 2)))
        window.scrollTo({ top: desired, behavior: 'smooth' })
      } finally {
        pendingFocusScrollRef.current = null
      }
    }
    const requestedId = pendingFocusScrollRef.current
    if (requestedId && requestedId !== focusRootId) {
      pendingFocusScrollRef.current = focusRootId
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(runScroll)
    })
  }, [focusRootId, editor])

  return (
    <div style={{ position:'relative' }}>
      <FilterControls
        isReadOnly={isReadOnly}
        availableFilters={availableFilters}
        statusFilter={statusFilter}
        onToggleStatus={toggleStatusFilter}
        onApplyPreset={applyPresetFilter}
        showArchived={showArchived}
        onToggleArchived={handleToggleArchived}
        showFuture={showFuture}
        onToggleFuture={handleToggleFuture}
        showSoon={showSoon}
        onToggleSoon={handleToggleSoon}
        includeFilterList={includeFilterList}
        excludeFilterList={excludeFilterList}
        includeInputRef={includeInputRef}
        excludeInputRef={excludeInputRef}
        includeTagInput={includeTagInput}
        excludeTagInput={excludeTagInput}
        onIncludeChange={includeChangeHandler}
        onIncludeKeyDown={includeKeyDownHandler}
        onIncludeBlur={includeBlurHandler}
        onExcludeChange={excludeChangeHandler}
        onExcludeKeyDown={excludeKeyDownHandler}
        onExcludeBlur={excludeBlurHandler}
        removeTagFilter={removeTagFilter}
        hasTagFilters={hasTagFilters}
        onClearTagFilters={clearTagFilters}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
      />
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
        <div
          ref={menuRef}
          className="slash-menu"
          style={{ left: slashPos.x, top: slashPos.y }}
          onMouseDown={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
          }}
        >
          <input
            type="text"
            value={slashQuery}
            onChange={(e) => {
              updateSlashActive(0)
              setSlashQuery(e.target.value)
            }}
            placeholder="Type a command…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const command = filteredCommands[slashActiveIndex] || filteredCommands[0]
                command?.run()
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                closeSlash()
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (filteredCommands.length) {
                  const next = (slashActiveIndex + 1) % filteredCommands.length
                  updateSlashActive(next)
                }
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (filteredCommands.length) {
                  const next = (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length
                  updateSlashActive(next)
                }
                return
              }
            }}
            ref={slashInputRef}
            autoFocus
          />
          {filteredCommands.length ? (
            filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                onClick={cmd.run}
                className={idx === slashActiveIndex ? 'active' : ''}
              >
            <span className="cmd-label">{cmd.label}</span>
            {cmd.hint ? <span className="cmd-hint">{cmd.hint}</span> : null}
          </button>
        ))
          ) : (
            <div className="slash-empty">No matches</div>
          )}
          {!slashQuery && filteredCommands.length > 0 && (
            <div className="slash-hint">Type to filter commands · Enter to accept</div>
          )}
        </div>
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

      {showDebug && (
        <div className="debug-pane">
          {debugLines.slice(-40).map((l, i) => <div className="debug-line" key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
