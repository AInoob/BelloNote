
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
import { DOMSerializer, Fragment } from 'prosemirror-model'
import { API_ROOT, absoluteUrl, getOutline, saveOutlineApi, uploadImage } from '../api.js'
import { describeTimeUntil, useReminders } from '../context/ReminderContext.jsx'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'
import { WorkDateHighlighter } from '../extensions/workDateHighlighter'
import { DetailsBlock } from '../extensions/detailsBlock.jsx'
import { safeReactNodeViewRenderer } from '../tiptap/safeReactNodeViewRenderer.js'

const STATUS_EMPTY = ''
const STATUS_ORDER = ['todo', 'in-progress', 'done', STATUS_EMPTY]
const STATUS_ICON = { [STATUS_EMPTY]: '', 'todo': '○', 'in-progress': '◐', 'done': '✓' }
const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const COLLAPSED_KEY = 'worklog.collapsed'
const FILTER_STATUS_KEY = 'worklog.filter.status'
const FILTER_ARCHIVED_KEY = 'worklog.filter.archived'
const FILTER_FUTURE_KEY = 'worklog.filter.future'
const FILTER_SOON_KEY = 'worklog.filter.soon'
const SCROLL_STATE_KEY = 'worklog.lastScroll'
const STARTER_PLACEHOLDER_TITLE = 'Start here'

const FILTER_TAG_INCLUDE_KEY = 'worklog.filter.tags.include'
const FILTER_TAG_EXCLUDE_KEY = 'worklog.filter.tags.exclude'
const TAG_VALUE_RE = /^[a-zA-Z0-9][\w-]{0,63}$/
const TAG_SCAN_RE = /(^|[^0-9A-Za-z_\/])#([a-zA-Z0-9][\w-]{0,63})\b/g

const parseTagInput = (value = '') => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (!TAG_VALUE_RE.test(withoutHash)) return null
  const canonical = withoutHash.toLowerCase()
  return { canonical, display: withoutHash }
}

const extractTagsFromText = (text = '') => {
  if (typeof text !== 'string' || !text) return []
  const seen = new Map()
  TAG_SCAN_RE.lastIndex = 0
  let match
  while ((match = TAG_SCAN_RE.exec(text)) !== null) {
    const raw = match[2]
    if (!raw) continue
    const canonical = raw.toLowerCase()
    if (!seen.has(canonical)) seen.set(canonical, raw)
  }
  return Array.from(seen, ([canonical, display]) => ({ canonical, display }))
}

const LOG_ON = () => (localStorage.getItem('WL_DEBUG') === '1')
const LOG = (...args) => { if (LOG_ON()) console.log('[slash]', ...args) }

const COLLAPSED_CACHE = new Map()

const collapsedStorageKey = (focusRootId) => focusRootId ? `${COLLAPSED_KEY}.${focusRootId}` : COLLAPSED_KEY

const loadCollapsedSetForRoot = (focusRootId) => {
  if (typeof window === 'undefined') return new Set()
  const key = collapsedStorageKey(focusRootId)
  if (!COLLAPSED_CACHE.has(key)) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(key) || '[]')
      if (Array.isArray(raw)) {
        COLLAPSED_CACHE.set(key, raw.map(String))
      } else {
        COLLAPSED_CACHE.set(key, [])
      }
    } catch {
      COLLAPSED_CACHE.set(key, [])
    }
  }
  return new Set(COLLAPSED_CACHE.get(key) || [])
}

const saveCollapsedSetForRoot = (focusRootId, set) => {
  if (typeof window === 'undefined') return
  const key = collapsedStorageKey(focusRootId)
  const arr = Array.from(set || []).map(String)
  COLLAPSED_CACHE.set(key, arr)
  try {
    window.localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

const focusContextDefaults = {
  focusRootId: null,
  requestFocus: () => {},
  exitFocus: () => {},
  loadCollapsedSet: loadCollapsedSetForRoot,
  saveCollapsedSet: saveCollapsedSetForRoot,
  forceExpand: false
}

const FocusContext = React.createContext(focusContextDefaults)

const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\-_]/g, (match) => `\\${match}`)
}

const gatherOwnListItemText = (listItemNode) => {
  if (!listItemNode || listItemNode.type?.name !== 'listItem') return ''
  const parts = []
  const visit = (pmNode) => {
    if (!pmNode) return
    const typeName = pmNode.type?.name
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    if (pmNode.isText && pmNode.text) {
      parts.push(pmNode.text)
      return
    }
    if (typeof pmNode.forEach === 'function') {
      pmNode.forEach(child => visit(child))
    }
  }
  listItemNode.forEach(child => {
    const typeName = child.type?.name
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    visit(child)
  })
  return parts.join(' ')
}

const DEFAULT_STATUS_FILTER = { none: true, todo: true, 'in-progress': true, done: true }
const loadStatusFilter = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STATUS_KEY) || 'null')
    const obj = (raw && typeof raw === 'object') ? raw : {}
    return {
      none: typeof obj.none === 'boolean' ? obj.none : true,
      todo: typeof obj.todo === 'boolean' ? obj.todo : true,
      'in-progress': typeof obj['in-progress'] === 'boolean' ? obj['in-progress'] : true,
      done: typeof obj.done === 'boolean' ? obj.done : true,
    }
  } catch {
    return { ...DEFAULT_STATUS_FILTER }
  }
}
const saveStatusFilter = (f) => {
  try { localStorage.setItem(FILTER_STATUS_KEY, JSON.stringify({ ...DEFAULT_STATUS_FILTER, ...(f||{}) })) } catch {}
}
const loadArchivedVisible = () => {
  try { const v = localStorage.getItem(FILTER_ARCHIVED_KEY); return v === '0' ? false : true } catch { return true }
}
const saveArchivedVisible = (v) => { try { localStorage.setItem(FILTER_ARCHIVED_KEY, v ? '1' : '0') } catch {} }
const loadFutureVisible = () => { try { const v = localStorage.getItem(FILTER_FUTURE_KEY); return v === '0' ? false : true } catch { return true } }
const saveFutureVisible = (v) => { try { localStorage.setItem(FILTER_FUTURE_KEY, v ? '1' : '0') } catch {} }
const loadSoonVisible = () => { try { const v = localStorage.getItem(FILTER_SOON_KEY); return v === '0' ? false : true } catch { return true } }
const DEFAULT_TAG_FILTER = { include: [], exclude: [] }
const normalizeTagArray = (input) => {
  const set = new Set()
  if (Array.isArray(input)) {
    input.forEach(item => {
      if (typeof item !== 'string') return
      const parsed = parseTagInput(item)
      if (parsed) set.add(parsed.canonical)
    })
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}
const loadTagFilters = () => {
  if (typeof window === 'undefined') return { ...DEFAULT_TAG_FILTER }
  try {
    const includeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_INCLUDE_KEY) || '[]')
    const excludeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_EXCLUDE_KEY) || '[]')
    const include = normalizeTagArray(includeRaw)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(excludeRaw).filter(tag => !includeSet.has(tag))
    return { include, exclude }
  } catch {
    return { ...DEFAULT_TAG_FILTER }
  }
}
const saveTagFilters = (filters) => {
  try {
    const include = normalizeTagArray(filters?.include)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(filters?.exclude).filter(tag => !includeSet.has(tag))
    localStorage.setItem(FILTER_TAG_INCLUDE_KEY, JSON.stringify(include))
    localStorage.setItem(FILTER_TAG_EXCLUDE_KEY, JSON.stringify(exclude))
  } catch {}
}
const saveSoonVisible = (v) => { try { localStorage.setItem(FILTER_SOON_KEY, v ? '1' : '0') } catch {} }
const loadScrollState = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SCROLL_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed.scrollY !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

const URL_PROTOCOL_RE = /^[a-z][\w+.-]*:\/\//i
const DOMAIN_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?:\/[\w#?=&%+@.\-]*)?$/i

const isLikelyUrl = (value = '') => {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (URL_PROTOCOL_RE.test(trimmed)) {
    try { new URL(trimmed); return true } catch { return false }
  }
  return DOMAIN_LIKE_RE.test(trimmed)
}

const normalizeUrl = (value = '') => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (URL_PROTOCOL_RE.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const escapeForRegex = (value = '') => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

function CodeBlockView(props) {
  const { node, extension, updateAttributes, editor } = props
  const [copied, setCopied] = useState(false)
  const codeText = useMemo(() => node.textContent || '', [node])
  const languageLabel = useMemo(() => {
    const raw = node.attrs.language
    if (!raw || typeof raw !== 'string') return 'Code'
    if (!raw.trim()) return 'Code'
    return raw
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(part => part[0]?.toUpperCase() + part.slice(1))
      .join(' ')
  }, [node.attrs.language])

  const handleCopy = async () => {
    const text = codeText.replace(/\u200b/g, '')
    const reset = () => setCopied(false)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(reset, 1500)
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(reset, 1500)
      } catch {
        setCopied(false)
      }
    }
  }

  return (
    <NodeViewWrapper className="code-block-wrapper" data-language={node.attrs.language || ''}>
      <div className="code-block-actions" contentEditable={false} tabIndex={-1}>
        <span className="code-block-label">{languageLabel}</span>
        <button
          type="button"
          className={`code-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          tabIndex={-1}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>
          <NodeViewContent as="span" />
        </code>
      </pre>
    </NodeViewWrapper>
  )
}

function createTaskListItemExtension({ readOnly, draggingState, allowStatusToggleInReadOnly, onStatusToggle, reminderActionsEnabled }) {
  return ListItem.extend({
    name: 'listItem',
    draggable: !readOnly,
    selectable: true,
    addAttributes() {
      return {
        dataId: { default: null },
        status: { default: STATUS_EMPTY },
        collapsed: { default: false },
        archivedSelf: { default: false },
        futureSelf: { default: false },
        soonSelf: { default: false },
        tags: { default: [] }
      }
    },
    addNodeView() {
      return safeReactNodeViewRenderer((props) => (
        <ListItemView
          {...props}
          readOnly={readOnly}
          draggingState={draggingState}
          allowStatusToggleInReadOnly={allowStatusToggleInReadOnly}
          onStatusToggle={onStatusToggle}
          reminderActionsEnabled={reminderActionsEnabled}
        />
      ))
    }
  })
}

function ListItemView(props) {
  const {
    node,
    updateAttributes,
    editor,
    getPos,
    readOnly = false,
    draggingState,
    allowStatusToggleInReadOnly = false,
    onStatusToggle = null,
    reminderActionsEnabled: reminderActionsEnabledProp = false
  } = props
  const id = node.attrs.dataId
  const statusAttr = node.attrs.status ?? STATUS_EMPTY
  const collapsed = !!node.attrs.collapsed
  const tags = Array.isArray(node.attrs.tags) ? node.attrs.tags.map(t => String(t || '').toLowerCase()) : []
  const fallbackIdRef = useRef(id ? String(id) : `temp-${Math.random().toString(36).slice(2, 8)}`)
  const justDraggedRef = useRef(false)
  const draggingRef = draggingState || { current: null }
  const focusConfig = useContext(FocusContext) || focusContextDefaults
  const focusRootId = focusConfig.focusRootId ?? null
  const loadCollapsedSet = focusConfig.loadCollapsedSet || loadCollapsedSetForRoot
  const saveCollapsedSet = focusConfig.saveCollapsedSet || saveCollapsedSetForRoot
  const requestFocus = focusConfig.requestFocus || (() => {})
  const { remindersByTask, scheduleReminder, dismissReminder, completeReminder, removeReminder } = useReminders()
  const reminderKey = id ? String(id) : null
  const reminder = reminderKey ? remindersByTask.get(reminderKey) || null : null
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false)
  const defaultCustomDate = () => {
    const base = reminder?.remindAt ? dayjs(reminder.remindAt) : dayjs().add(30, 'minute')
    if (!base || !base.isValid?.()) return dayjs().add(30, 'minute').format('YYYY-MM-DDTHH:mm')
    return base.format('YYYY-MM-DDTHH:mm')
  }
  const [customMode, setCustomMode] = useState(false)
  const [customDate, setCustomDate] = useState(defaultCustomDate)
  const [reminderError, setReminderError] = useState('')
  const reminderMenuRef = useRef(null)
  const rowRef = useRef(null)
  const reminderControlsEnabled = reminderActionsEnabledProp
  const [isActive, setIsActive] = useState(false)
  const reminderAreaRef = useRef(null)
  const [reminderOffset, setReminderOffset] = useState(null)
  const [reminderInlineGap, setReminderInlineGap] = useState(0)
  const [reminderTop, setReminderTop] = useState(0)
  const ownBodyText = useMemo(() => gatherOwnListItemText(node), [node])
  const ownBodyTextAttr = useMemo(() => (ownBodyText || '').replace(/\s+/g, ' ').trim(), [ownBodyText])

  useEffect(() => {
    if (id) fallbackIdRef.current = String(id)
  }, [id])

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') return
    const updateSelectionState = () => {
      try {
        const pos = getPos()
        if (typeof pos !== 'number') {
          setIsActive(false)
          return
        }
        const { from, to } = editor.state.selection
        const end = pos + node.nodeSize
        const intersects = (from >= pos && from <= end) || (to >= pos && to <= end) || (from <= pos && to >= end)
        const hasFocus = editor?.view?.hasFocus?.()
        setIsActive(Boolean(intersects && hasFocus))
      } catch {
        setIsActive(false)
      }
    }
    const handleBlur = () => setIsActive(false)
    updateSelectionState()
    editor.on('selectionUpdate', updateSelectionState)
    editor.on('transaction', updateSelectionState)
    editor.on('focus', updateSelectionState)
    editor.on('blur', handleBlur)
    return () => {
      editor.off('selectionUpdate', updateSelectionState)
      editor.off('transaction', updateSelectionState)
      editor.off('focus', updateSelectionState)
      editor.off('blur', handleBlur)
    }
  }, [editor, getPos, node])

  useEffect(() => {
    const key = id ? String(id) : fallbackIdRef.current
    if (!key) return
    const collapsedSet = loadCollapsedSet(focusRootId)
    const shouldCollapse = collapsedSet.has(key)
    if (shouldCollapse !== collapsed) updateAttributes({ collapsed: shouldCollapse })
  }, [id, collapsed, updateAttributes, loadCollapsedSet, focusRootId])

  useEffect(() => {
    if (!reminderControlsEnabled) return
    if (!reminderMenuOpen) return
    const handleClick = (event) => {
      if (reminderMenuRef.current && !reminderMenuRef.current.contains(event.target)) {
        setReminderMenuOpen(false)
        setCustomMode(false)
        setReminderError('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [reminderMenuOpen, reminderControlsEnabled])

  const toggleCollapse = () => {
    const next = !collapsed
    updateAttributes({ collapsed: next })
    const key = id ? String(id) : fallbackIdRef.current
    if (!key) return
    const set = loadCollapsedSet(focusRootId)
    if (next) set.add(key)
    else set.delete(key)
    saveCollapsedSet(focusRootId, set)
  }

  const readCurrentDomId = () => {
    const li = rowRef.current?.closest('li.li-node')
    if (!li) return id ? String(id) : fallbackIdRef.current
    return li.getAttribute('data-id') || li.dataset?.id || (id ? String(id) : fallbackIdRef.current)
  }


  const ensurePersistentTaskId = useCallback(async () => {
    let currentId = readCurrentDomId()
    if (currentId && !String(currentId).startsWith('new-')) return currentId
    window.dispatchEvent(new CustomEvent('worklog:request-save'))
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
      currentId = readCurrentDomId()
      if (currentId && !String(currentId).startsWith('new-')) return currentId
    }
    throw new Error('Task must be saved before setting a reminder')
  }, [id])

  const closeReminderMenu = useCallback(() => {
    setReminderMenuOpen(false)
    setCustomMode(false)
    setCustomDate('')
    setReminderError('')
  }, [])

  const scheduleAfterMinutes = useCallback(async (minutes) => {
    if (!reminderControlsEnabled) return
    try {
      setReminderError('')
      const realId = await ensurePersistentTaskId()
      const remindAt = dayjs().add(minutes, 'minute').toDate().toISOString()
      await scheduleReminder({ taskId: Number(realId), remindAt })
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, scheduleReminder])

  const handleCustomSubmit = useCallback(async (event) => {
    event.preventDefault()
    if (!reminderControlsEnabled) return
    if (!customDate) {
      setReminderError('Select a date and time')
      return
    }
    try {
      const realId = await ensurePersistentTaskId()
      const dateValue = new Date(customDate)
      if (Number.isNaN(dateValue.valueOf())) throw new Error('Invalid date')
      const remindAt = dateValue.toISOString()
      await scheduleReminder({ taskId: Number(realId), remindAt })
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, customDate, ensurePersistentTaskId, scheduleReminder])

  const handleDismissReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    if (!reminder) return
    try {
      await dismissReminder(reminder.id)
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to dismiss reminder')
    }
  }, [closeReminderMenu, dismissReminder, reminder])

  const handleCompleteReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    if (!reminder) return
    try {
      await completeReminder(reminder.id)
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to mark complete')
    }
  }, [closeReminderMenu, completeReminder, reminder])

  const handleRemoveReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    if (!reminder) return
    try {
      await removeReminder(reminder.id)
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to remove reminder')
    }
  }, [closeReminderMenu, removeReminder, reminder])

  const handleStatusKeyDown = useCallback((event) => {
    if (event.key !== 'Enter') return
    if (readOnly && !allowStatusToggleInReadOnly) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (typeof pos !== 'number' || !editor) return
      const { state, view } = editor
      const listItemNode = state.doc.nodeAt(pos)
      if (!listItemNode || listItemNode.type.name !== 'listItem' || listItemNode.childCount === 0) return
      const paragraphNode = listItemNode.child(0)
      if (!paragraphNode || paragraphNode.type.name !== 'paragraph') return
      editor.commands.focus()
      const paragraphStart = pos + 1
      const paragraphEnd = paragraphStart + paragraphNode.nodeSize - 1
      const tr = state.tr.setSelection(TextSelection.create(state.doc, paragraphEnd))
      view.dispatch(tr)
      const didSplit = editor.commands.splitListItem('listItem')
      if (didSplit) {
        editor.commands.updateAttributes('listItem', { status: STATUS_EMPTY, dataId: null, collapsed: false })
      }
    } catch {}
  }, [editor, getPos, readOnly, allowStatusToggleInReadOnly])

  const cycle = (event) => {
    if (readOnly && !allowStatusToggleInReadOnly) return
    const li = rowRef.current?.closest('li.li-node')
    const liveStatus = li?.getAttribute('data-status')
    const currentStatus = typeof liveStatus === 'string' ? liveStatus : (node?.attrs?.status ?? STATUS_EMPTY)
    const currentIndex = STATUS_ORDER.indexOf(currentStatus)
    const idx = currentIndex >= 0 ? currentIndex : 0
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
    updateAttributes({ status: next })
    if (readOnly && allowStatusToggleInReadOnly && typeof onStatusToggle === 'function') {
      const realId = id || fallbackIdRef.current
      if (realId) onStatusToggle(String(realId), next)
    }
    if (event?.currentTarget?.blur) {
      try { event.currentTarget.blur() } catch {}
    }
    editor?.commands?.focus?.()
  }

  const handleDragStart = (event) => {
    if (readOnly) return
    try {
      justDraggedRef.current = true
      let currentId = id ? String(id) : fallbackIdRef.current
      if (!currentId) {
        currentId = 'new-' + Math.random().toString(36).slice(2, 8)
        updateAttributes({ dataId: currentId })
      }
      fallbackIdRef.current = currentId
      const pos = getPos()
      const view = editor.view
      const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
      view.dispatch(tr)
      console.log('[drag] start', { id: currentId, pos })
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', ' ')
        event.dataTransfer.effectAllowed = 'move'
      }
      view.dragging = { slice: view.state.selection.content(), move: true }
      if (event.currentTarget instanceof HTMLElement) {
        const wrapper = event.currentTarget.closest('li.li-node')
        if (wrapper) wrapper.setAttribute('data-id', currentId)
      }
      if (draggingRef) {
        draggingRef.current = {
          id: currentId,
          element: event.currentTarget instanceof HTMLElement
            ? event.currentTarget.closest('li.li-node')
            : null
        }
      }
    } catch (e) {
      console.error('[drag] failed to select node', e)
    }
  }

  const handleDragEnd = () => {
    if (readOnly) return
    const last = draggingRef?.current
    if (last) console.log('[drag] end', { id: last.id })
    if (draggingRef) draggingRef.current = null
    if (editor?.view) editor.view.dragging = null
    // Defer resetting until after click events complete so we can detect drag+click
    setTimeout(() => { justDraggedRef.current = false }, 0)
  }

  const handleToggleClick = () => {
    if (justDraggedRef.current) {
      // Skip toggling when the control was just used for dragging
      justDraggedRef.current = false
      return
    }
    toggleCollapse()
  }

  const reminderDismissed = !!reminder?.dismissedAt
  const activeReminder = reminder && reminder.status !== 'completed'
  const reminderDue = activeReminder && !reminderDismissed && (
    reminder?.due || (reminder?.remindAt && dayjs(reminder.remindAt).isBefore(dayjs()))
  )
  const reminderSummary = useMemo(() => {
    if (!reminder) return ''
    if (!activeReminder) return 'Reminder completed'
    if (reminderDue) return 'Reminder due'
    if (reminderDismissed) return 'Reminder dismissed'
    const relative = describeTimeUntil(reminder)
    return relative ? `Reminds ${relative}` : 'Reminder scheduled'
  }, [activeReminder, reminder, reminderDue, reminderDismissed])
  const reminderButtonLabel = reminderSummary
    ? `Reminder options (${reminderSummary})`
    : 'Reminder options'
  const reminderPillText = useMemo(() => {
    if (!activeReminder) return ''
    if (reminderDue) return 'Due soon'
    if (reminderDismissed) return 'Dismissed'
    const relative = describeTimeUntil(reminder)
    return relative ? `Reminds ${relative}` : ''
  }, [activeReminder, reminder, reminderDue, reminderDismissed])


  useEffect(() => {
    if (!reminderControlsEnabled) {
      setReminderOffset(null)
      setReminderInlineGap(0)
      setReminderTop(0)
    }
  }, [reminderControlsEnabled])

  useLayoutEffect(() => {
    if (!reminderControlsEnabled) return
    const measure = () => {
      const areaEl = reminderAreaRef.current
      const rowEl = rowRef.current
      if (!areaEl || !rowEl) return
      const rowRect = rowEl.getBoundingClientRect()
      const mainEl = rowEl.querySelector(':scope > .li-main')
      if (!mainEl) return
      const mainRect = mainEl.getBoundingClientRect()
      if (!mainRect || !mainRect.width) return
      const areaRect = areaEl.getBoundingClientRect()
      const areaWidth = areaRect?.width ?? 0
      const contentEl = rowEl.querySelector(':scope > .li-main .li-content')
      let firstRect = null
      if (contentEl) {
        const paragraph = contentEl.querySelector('p')
        if (paragraph) {
          const range = document.createRange()
          range.selectNodeContents(paragraph)
          const rects = range.getClientRects()
          if (rects.length > 0) {
            firstRect = Array.from(rects).reduce((acc, rect) => {
              if (!acc) return rect
              return rect.right > acc.right ? rect : acc
            }, null)
          } else {
            const rect = range.getBoundingClientRect()
            if (rect && rect.width) firstRect = rect
          }
          range.detach?.()
        }
        if (!firstRect) {
          const fallbackCandidate = contentEl.querySelector(':scope > *:not(ul):not(ol)')
          if (fallbackCandidate) {
            const range = document.createRange()
            range.selectNodeContents(fallbackCandidate)
            const rects = range.getClientRects()
            if (rects.length > 0) {
              firstRect = Array.from(rects).reduce((acc, rect) => {
                if (!acc) return rect
                return rect.right > acc.right ? rect : acc
              }, null)
            } else {
              const rect = range.getBoundingClientRect()
              if (rect && rect.width) firstRect = rect
            }
            range.detach?.()
          }
        }
        if (!firstRect) {
          const fallbackRect = contentEl.getBoundingClientRect()
          if (fallbackRect && fallbackRect.width) firstRect = fallbackRect
        }
      }
      if (!firstRect) firstRect = mainRect
      const textRight = firstRect?.right ?? mainRect.left
      const spacing = 6
      const hostWidth = Math.max(rowRect?.width ?? 0, mainRect.width)
      const maxOffset = Math.max(0, hostWidth - areaWidth - 4)
      const desiredOffset = Math.max(0, (textRight - mainRect.left) + spacing)
      const offset = Math.min(maxOffset, desiredOffset)
      setReminderOffset(prev => {
        if (prev !== null && Math.abs(prev - offset) < 0.5) return prev
        return offset
      })
      const reserveCeiling = Math.max(0, Math.floor(hostWidth - 20))
      const reserveGap = areaWidth
        ? Math.max(
            0,
            Math.min(
              Math.ceil(Math.max(areaWidth + spacing, spacing + 6)),
              reserveCeiling
            )
          )
        : 0
      setReminderInlineGap(prev => {
        if (Math.abs(prev - reserveGap) < 0.5) return prev
        return reserveGap
      })

      const textTop = firstRect?.top ?? mainRect.top
      const textHeight = firstRect?.height ?? 0
      const areaHeight = areaRect?.height ?? 0
      let verticalOffset = Math.max(0, textTop - mainRect.top)
      if (areaHeight && textHeight) {
        const textMid = (textTop - mainRect.top) + textHeight / 2
        verticalOffset = Math.max(0, textMid - areaHeight / 2)
      }
      setReminderTop(prev => {
        if (Math.abs(prev - verticalOffset) < 0.5) return prev
        return verticalOffset
      })
    }

    measure()
    const resizeObserver = new ResizeObserver(() => measure())
    if (rowRef.current) resizeObserver.observe(rowRef.current)
    if (reminderAreaRef.current) resizeObserver.observe(reminderAreaRef.current)
    const contentEl = rowRef.current?.querySelector(':scope > .li-main .li-content')
    const mutationObserver = contentEl ? new MutationObserver(() => measure()) : null
    if (contentEl && mutationObserver) mutationObserver.observe(contentEl, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [reminderControlsEnabled, reminderMenuOpen, reminderPillText, activeReminder, collapsed])

  return (
    <NodeViewWrapper
      as="li"
      className={`li-node ${collapsed ? 'collapsed' : ''}`}
      data-status={statusAttr}
      data-id={id ? String(id) : fallbackIdRef.current}
      data-archived-self={node.attrs.archivedSelf ? '1' : '0'}
      data-archived={node.attrs.archivedSelf ? '1' : '0'}
      data-future-self={node.attrs.futureSelf ? '1' : '0'}
      data-soon-self={node.attrs.soonSelf ? '1' : '0'}
      data-future={node.attrs.futureSelf ? '1' : '0'}
      data-soon={node.attrs.soonSelf ? '1' : '0'}
      data-tags-self={tags.join(',')}
      data-body-text={ownBodyTextAttr}
      draggable={!readOnly}
      onDragEnd={readOnly ? undefined : handleDragEnd}
    >
      <div className={`li-row ${isActive ? 'is-selected' : ''}`} ref={rowRef}>
        <button
          className="caret drag-toggle"
          onClick={handleToggleClick}
          title={collapsed ? 'Expand (drag to reorder)' : 'Collapse (drag to reorder)'}
          draggable={!readOnly}
          onDragStart={readOnly ? undefined : handleDragStart}
          type="button"
        >
          <span className="caret-arrow" aria-hidden>{collapsed ? '▸' : '▾'}</span>
          <span className="caret-grip" aria-hidden>⋮</span>
        </button>
        <button
          className="status-chip inline"
          onClick={(readOnly && !allowStatusToggleInReadOnly) ? undefined : cycle}
          title="Click to change status"
          disabled={readOnly && !allowStatusToggleInReadOnly}
          onKeyDown={handleStatusKeyDown}
        >
          {statusAttr === STATUS_EMPTY ? '' : (STATUS_ICON[statusAttr] ?? '○')}
        </button>
        <div className="li-main">
          <NodeViewContent
            className="li-content"
            style={reminderControlsEnabled ? { '--reminder-inline-gap': `${reminderInlineGap}px` } : undefined}
          />
          {reminderControlsEnabled && (
            <div
              ref={reminderAreaRef}
              className={`li-reminder-area ${reminderOffset !== null ? 'floating' : ''} ${activeReminder ? 'has-reminder' : ''} ${reminderDue ? 'due' : ''} ${reminderDismissed ? 'dismissed' : ''}`}
              style={reminderOffset !== null ? { left: `${reminderOffset}px`, top: `${reminderTop}px` } : undefined}
              contentEditable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="reminder-toggle icon-only"
                aria-label={reminderButtonLabel}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setReminderError('')
                  setCustomMode(false)
                  setCustomDate(defaultCustomDate())
                  setReminderMenuOpen(v => !v)
                }}
              >
                <span aria-hidden>⋮</span>
              </button>
              {activeReminder && reminderPillText && (
                <span className="reminder-pill" title={reminderSummary || undefined}>{reminderPillText}</span>
              )}
              {reminderMenuOpen && (
                <div className="reminder-menu" ref={reminderMenuRef}>
                  <div className="reminder-menu-section">
                    <div className="menu-heading">Remind me in</div>
                    <div className="menu-buttons">
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(30)}>30 minutes</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(60)}>1 hour</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(180)}>3 hours</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(1380)}>23 hours</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(1440)}>24 hours</button>
                    </div>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        setCustomMode(v => !v)
                        setReminderError('')
                        setCustomDate(defaultCustomDate())
                      }}
                    >Custom…</button>
                    {customMode && (
                      <form className="menu-custom" onSubmit={handleCustomSubmit}>
                        <input
                          type="datetime-local"
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          required
                        />
                        <div className="menu-buttons">
                          <button type="submit" className="btn small">Set reminder</button>
                        </div>
                      </form>
                    )}
                  </div>
                  {reminder && (
                    <div className="reminder-menu-section">
                      <div className="menu-heading">Actions</div>
                      {activeReminder && (
                        <>
                          <button type="button" className="btn small" onClick={handleCompleteReminder}>Mark complete</button>
                          {!reminderDismissed && (
                            <button type="button" className="btn small ghost" onClick={handleDismissReminder}>Dismiss</button>
                          )}
                        </>
                      )}
                      <button type="button" className="btn small ghost" onClick={handleRemoveReminder}>Remove reminder</button>
                    </div>
                  )}
                  {reminderError && (
                    <div className="reminder-error">{reminderError}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default function OutlinerView({
  onSaveStateChange = () => {},
  showDebug = false,
  readOnly = false,
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
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 })
  const [debugLines, setDebugLines] = useState([])
  const menuRef = useRef(null)
  const slashMarker = useRef(null)
  const [showFuture, setShowFuture] = useState(() => loadFutureVisible())
  const [showSoon, setShowSoon] = useState(() => loadSoonVisible())
  const [imagePreview, setImagePreview] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => loadStatusFilter())
  const [showArchived, setShowArchived] = useState(() => loadArchivedVisible())
  const [tagFilters, setTagFilters] = useState(() => loadTagFilters())
  const [includeTagInput, setIncludeTagInput] = useState('')
  const [excludeTagInput, setExcludeTagInput] = useState('')
  const applyStatusFilterRef = useRef(null)
  const showFutureRef = useRef(showFuture)
  const showSoonRef = useRef(showSoon)
  const showArchivedRef = useRef(showArchived)
  const statusFilterRef = useRef(statusFilter)
  const tagFiltersRef = useRef(tagFilters)
  const includeInputRef = useRef(null)
  const excludeInputRef = useRef(null)
  const restoredScrollRef = useRef(false)
  const scrollSaveFrameRef = useRef(null)
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
  const focusShortcutActiveRef = useRef(false)
  const { remindersByTask } = useReminders()
  const activeTaskInfoRef = useRef(null)
  const lastFocusTokenRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const applyShortcutState = (active) => {
      if (focusShortcutActiveRef.current === active) return
      focusShortcutActiveRef.current = active
      if (typeof document === 'undefined') return
      const body = document.body
      if (!body) return
      body.classList.toggle('focus-shortcut-available', active)
    }

    const computeActive = (event) => {
      if (!event) return false
      return !!(event.metaKey || (event.ctrlKey && !event.metaKey))
    }

    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleKeyUp = (event) => {
      if (focusShortcutActiveRef.current || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleBlur = () => applyShortcutState(false)

    const handleVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') applyShortcutState(false)
    }

    const doc = typeof document !== 'undefined' ? document : null

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    if (doc) {
      doc.addEventListener('keydown', handleKeyDown, true)
      doc.addEventListener('keyup', handleKeyUp, true)
      doc.addEventListener('visibilitychange', handleVisibility)
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      if (doc) {
        doc.removeEventListener('keydown', handleKeyDown, true)
        doc.removeEventListener('keyup', handleKeyUp, true)
        doc.removeEventListener('visibilitychange', handleVisibility)
      }
      applyShortcutState(false)
    }
  }, [])

  const readFocusFromLocation = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get('focus')
    } catch {
      return null
    }
  }, [])

  const migrateCollapsedSets = useCallback((idMapping) => {
    if (!idMapping || typeof idMapping !== 'object') return
    const entries = Object.entries(idMapping)
    if (!entries.length) return
    const normalize = (value) => String(value ?? '')
    const replaceInArray = (arr) => arr.map(value => {
      const mapped = idMapping[normalize(value)]
      return mapped !== undefined ? normalize(mapped) : normalize(value)
    })
    const writeCacheAndStorage = (key, arrValues) => {
      const normalized = arrValues.map(normalize)
      COLLAPSED_CACHE.set(key, normalized)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(key, JSON.stringify(normalized))
        } catch {}
      }
    }

    entries.forEach(([oldIdRaw, newIdRaw]) => {
      const oldId = normalize(oldIdRaw)
      const newId = normalize(newIdRaw)
      const oldKey = collapsedStorageKey(oldId)
      const newKey = collapsedStorageKey(newId)
      if (COLLAPSED_CACHE.has(oldKey)) {
        const cached = COLLAPSED_CACHE.get(oldKey) || []
        writeCacheAndStorage(newKey, replaceInArray(cached))
        COLLAPSED_CACHE.delete(oldKey)
      }
      if (typeof window !== 'undefined') {
        try {
          const raw = window.localStorage.getItem(oldKey)
          if (raw !== null) {
            const parsed = JSON.parse(raw)
            const arr = Array.isArray(parsed) ? replaceInArray(parsed) : []
            window.localStorage.setItem(newKey, JSON.stringify(arr))
          }
          window.localStorage.removeItem(oldKey)
        } catch {}
      }
    })

    const cacheKeys = Array.from(COLLAPSED_CACHE.keys())
    cacheKeys.forEach((key) => {
      const current = COLLAPSED_CACHE.get(key) || []
      const updated = replaceInArray(current)
      let changed = updated.length !== current.length
      if (!changed) {
        for (let i = 0; i < updated.length; i += 1) {
          if (updated[i] !== current[i]) { changed = true; break }
        }
      }
      if (changed) writeCacheAndStorage(key, updated)
    })

    if (typeof window !== 'undefined') {
      const keysToReview = []
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (key && key.startsWith(COLLAPSED_KEY)) keysToReview.push(key)
      }
      keysToReview.forEach((key) => {
        try {
          const raw = window.localStorage.getItem(key)
          if (raw === null) return
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return
          const updated = replaceInArray(parsed)
          let changed = updated.length !== parsed.length
          if (!changed) {
            for (let i = 0; i < updated.length; i += 1) {
              if (updated[i] !== parsed[i]) { changed = true; break }
            }
          }
          if (changed) window.localStorage.setItem(key, JSON.stringify(updated))
        } catch {}
      })
    }
  }, [])

  // Persist filters in localStorage
  useEffect(() => { saveStatusFilter(statusFilter) }, [statusFilter])
  useEffect(() => { saveSoonVisible(showSoon) }, [showSoon])

  useEffect(() => { saveArchivedVisible(showArchived) }, [showArchived])
  useEffect(() => { saveFutureVisible(showFuture) }, [showFuture])
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { showSoonRef.current = showSoon }, [showSoon])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  useEffect(() => { showFutureRef.current = showFuture }, [showFuture])
  const [slashQuery, setSlashQuery] = useState('')
  const slashQueryRef = useRef('')
  const slashInputRef = useRef(null)
  const slashSelectedRef = useRef(0)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const filteredCommandsRef = useRef([])
  const closeSlashRef = useRef(() => {})
  const draggingRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const convertingImagesRef = useRef(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerValueRef = useRef(dayjs().format('YYYY-MM-DD'))
  const datePickerCaretRef = useRef(null)

  const pendingImageSrcRef = useRef(new Set())
  const includeFilterList = Array.isArray(tagFilters?.include) ? tagFilters.include : []
  const excludeFilterList = Array.isArray(tagFilters?.exclude) ? tagFilters.exclude : []
  const hasTagFilters = includeFilterList.length > 0 || excludeFilterList.length > 0

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

  const updateSlashActive = useCallback((idx) => {
    slashSelectedRef.current = idx
    setSlashActiveIndex(idx)
  }, [])

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])
  useEffect(() => { slashQueryRef.current = slashQuery }, [slashQuery])
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

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
    DetailsBlock
  ], [taskListItemExtension, CodeBlockWithCopy, imageExtension])

  const editor = useEditor({
    // disable default codeBlock to avoid duplicate name with CodeBlockLowlight
    extensions,
    content: '<p>Loading…</p>',
    autofocus: false,
    editable: !isReadOnly,
    onCreate: () => { pushDebug('editor: ready'); setTimeout(() => applyStatusFilter(), 50) },
    onUpdate: () => {
      if (!isReadOnly) {
        markDirty()
        queueSave()
      }
      setTimeout(() => applyStatusFilter(), 50)
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
        // 1) Prefer our lossless clipboard format when available
        try {
          const jsonStr = event.clipboardData?.getData('application/x-worklog-outline+json')
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr)
            event.preventDefault()
            editor?.commands?.setContent(parsed, true)
            markDirty()
            if (saveTimer.current) clearTimeout(saveTimer.current)
            void doSave()
            pushDebug('paste: outline json restored')
            return true
          }
        } catch {}
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
        if (isReadOnly) return false
        if (slashOpen) {
          if (event.key === 'Enter') {
            const command = filteredCommandsRef.current[slashSelectedRef.current] || filteredCommandsRef.current[0]
            if (command) {
              event.preventDefault()
              event.stopPropagation()
              command.run()
              return true
            }
          }
          if (event.key === 'ArrowDown') {
            if (filteredCommandsRef.current.length) {
              event.preventDefault()
              const next = (slashSelectedRef.current + 1) % filteredCommandsRef.current.length
              updateSlashActive(next)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            if (filteredCommandsRef.current.length) {
              event.preventDefault()
              const next = (slashSelectedRef.current - 1 + filteredCommandsRef.current.length) % filteredCommandsRef.current.length
              updateSlashActive(next)
            }
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeSlashRef.current()
            return true
          }
        }
        const isSlashKey = (event.key === '/' || event.code === 'Slash') && !event.shiftKey
        if (isSlashKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (inCode) { pushDebug('keydown "/" ignored in code block'); return false }
          event.preventDefault()
          event.stopPropagation()
          const char = '/'
          const { from } = editor.state.selection
          slashMarker.current = { pos: from, char }
          editor.chain().focus().insertContent(char).run()
          let rect
          try {
            const after = editor.state.selection.from
            rect = view.coordsAtPos(after)
          } catch (e) {
            rect = { left: 0, bottom: 0 }
            pushDebug('popup: coords fail', { error: e.message })
          }
          updateSlashActive(0)
          setSlashPos({ x: rect.left, y: rect.bottom + 4 })
          setSlashOpen(true)
          setSlashQuery('')
          pushDebug('popup: open (keydown)', { key: event.key, char, left: rect.left, top: rect.bottom })
          return true
        }
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key === 's' || event.key === 'S')) {
          event.preventDefault()
          event.stopPropagation()
          const info = computeActiveTask()
          const taskId = info?.id
          if (taskId) {
            onRequestTimelineFocus?.({
              taskId,
              hasReminder: !!info?.hasReminder,
              hasDate: !!info?.hasDate,
              reminderId: info?.reminderId,
              remindAt: info?.remindAt,
              dates: info?.dates
            })
          }
          return true
        }
        if (event.key === 'Enter') {
          const { state, view } = editor
          const { $from } = view.state.selection
          const inCode = $from.parent.type.name === 'codeBlock'
          if (inCode) return false
          const schema = editor.schema
          const listItemType = schema.nodes.listItem
          const paragraphType = schema.nodes.paragraph
          const bulletListType = schema.nodes.bulletList
          event.preventDefault()
          event.stopPropagation()

          const findListItemDepth = () => {
            for (let depth = $from.depth; depth >= 0; depth--) {
              if ($from.node(depth)?.type?.name === 'listItem') return depth
            }
            return -1
          }

          const listItemDepth = findListItemDepth()
          if (listItemDepth === -1) return false
          const listItemPos = $from.before(listItemDepth)
          const listItemNode = $from.node(listItemDepth)
          if (!listItemNode || listItemNode.type.name !== 'listItem' || listItemNode.childCount === 0) {
            return false
          }

          const paragraphNode = listItemNode.child(0)
          if (!paragraphNode || paragraphNode.type.name !== 'paragraph') {
            return false
          }

          const inParagraph = $from.parent === paragraphNode
          const offset = inParagraph ? $from.parentOffset : 0
          const isAtStart = inParagraph && offset === 0
          const isAtEnd = inParagraph && offset === paragraphNode.content.size
          const isChild = listItemDepth > 2
          pushDebug('enter: state', { isChild, isAtStart, isAtEnd, offset, paraSize: paragraphNode.content.size, collapsed: !!listItemNode.attrs?.collapsed })

          const defaultAttrs = {
            dataId: null,
            status: STATUS_EMPTY,
            collapsed: false,
            archivedSelf: false,
            futureSelf: false,
            soonSelf: false,
            tags: []
          }

          const placeCursorAtEnd = (tr, pos) => {
            const insertedNode = tr.doc.nodeAt(pos)
            if (!insertedNode || insertedNode.childCount === 0) return tr
            const para = insertedNode.child(0)
            const paragraphEnd = pos + 1 + para.nodeSize - 1
            return tr.setSelection(TextSelection.create(tr.doc, paragraphEnd))
          }

          if (isChild && isAtStart) {
            let tr = state.tr.insert(listItemPos, listItemType.create(defaultAttrs, Fragment.from(paragraphType.create())))
            tr = placeCursorAtEnd(tr, listItemPos)
            view.dispatch(tr)
            return true
          }

          if (!isChild && isAtEnd) {
            const newSibling = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
            const insertPos = listItemPos + listItemNode.nodeSize
            let tr = state.tr.insert(insertPos, newSibling)
            tr = placeCursorAtEnd(tr, insertPos)
            view.dispatch(tr.scrollIntoView())
            return true
          }

          const didSplit = editor.commands.splitListItem('listItem')
          if (didSplit) {
            editor.commands.updateAttributes('listItem', { status: STATUS_EMPTY, dataId: null, collapsed: false })
            return true
          }
          return false
        }
        if (event.key === 'Tab') {
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (!inCode) {
            event.preventDefault()
            const cmd = event.shiftKey ? 'liftListItem' : 'sinkListItem'
            editor.chain().focus()[cmd]('listItem').run()
            pushDebug('indentation', { shift: event.shiftKey })
            return true
          }
          return false
        }
        if (event.key === 'ArrowRight') {
          const { $from } = view.state.selection
          const parent = $from.parent
          if (parent.type.name === 'codeBlock' && $from.parentOffset === parent.content.size) {
            event.preventDefault()
            const exited = editor.commands.exitCode()
            if (!exited) {
              editor.chain().focus().insertContent('\n').run()
              editor.commands.exitCode()
            }
            pushDebug('codeblock: exit via ArrowRight')
            return true
          }
        }
        if (event.key === 'ArrowDown') {
          if (moveIntoFirstChild(view)) { event.preventDefault(); pushDebug('moveIntoFirstChild'); return true }
        }
        if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          const { from } = editor.state.selection
          const rect = view.coordsAtPos(from)
          setSlashPos({ x: rect.left, y: rect.bottom + 4 })
          setSlashOpen(true)
          pushDebug('popup: open (Ctrl/Cmd+Space)')
          return true
        }
        return false
      }
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__WORKLOG_EDITOR = editor
    }
    return () => {
      if (typeof window !== 'undefined' && window.__WORKLOG_EDITOR === editor) {
        window.__WORKLOG_EDITOR = null
      }
    }
  }, [editor])

  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  const ensureUploadedImages = useCallback(async () => {
    if (!editor || isReadOnly || convertingImagesRef.current) return
    convertingImagesRef.current = true
    try {
      const queue = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type?.name !== 'image') return
        const src = node.attrs?.src
        if (!src || !isDataUri(src) || pendingImageSrcRef.current.has(src)) return
        queue.push({ pos, src })
        pendingImageSrcRef.current.add(src)
      })
      for (const item of queue) {
        const payload = dataUriToFilePayload(item.src)
        if (!payload) {
          pendingImageSrcRef.current.delete(item.src)
          continue
        }
        try {
          const result = await uploadImage(payload.file, payload.name)
          const { state, view } = editor
          const node = state.doc.nodeAt(item.pos)
          if (!node || node.type?.name !== 'image') continue
          const attrs = { ...node.attrs }
          attrs.src = normalizeImageSrc(result.url)
          if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
          if (result?.id) attrs['data-file-id'] = result.id
          view.dispatch(state.tr.setNodeMarkup(item.pos, undefined, attrs))
        } catch (err) {
          console.error('[outline] failed to upload pasted image', err)
        } finally {
          pendingImageSrcRef.current.delete(item.src)
        }
      }
    } finally {
      convertingImagesRef.current = false
    }
  }, [editor, isReadOnly, normalizeImageSrc])

  useEffect(() => {
    if (!editor || isReadOnly) return
    const handler = () => { ensureUploadedImages() }
    editor.on('update', handler)
    ensureUploadedImages()
    return () => {
      editor.off('update', handler)
    }
  }, [editor, isReadOnly, ensureUploadedImages])

  const applySearchHighlight = useCallback(() => {
    if (!editor) return
    const { state } = editor
    const { doc, selection } = state
    const highlightMark = editor.schema.marks.highlight
    if (!highlightMark) return
    let tr = state.tr.removeMark(0, doc.content.size, highlightMark)
    const query = searchQueryRef.current.trim()
    if (!query) {
      tr.setMeta('addToHistory', false)
      tr.setSelection(selection.map(tr.doc, tr.mapping))
      editor.view.dispatch(tr)
      return
    }
    let regex
    try {
      regex = new RegExp(escapeForRegex(query), 'gi')
    } catch {
      tr.setMeta('addToHistory', false)
      tr.setSelection(selection.map(tr.doc, tr.mapping))
      editor.view.dispatch(tr)
      return
    }
    doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text || ''
      let match
      while ((match = regex.exec(text)) !== null) {
        const from = pos + match.index
        const to = from + match[0].length
        tr = tr.addMark(from, to, highlightMark.create({ color: '#fde68a' }))
      }
    })
    tr.setMeta('addToHistory', false)
    tr.setSelection(selection.map(tr.doc, tr.mapping))
    editor.view.dispatch(tr)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const updateSlashState = () => {
      const marker = slashMarker.current
      if (!marker) {
        if (slashQueryRef.current) setSlashQuery('')
        return
      }
      try {
        const { pos } = marker
        const { from } = editor.state.selection
        const to = Math.max(from, pos + 1)
        const text = editor.state.doc.textBetween(pos, to, '\n', '\n')
        if (!text.startsWith('/')) {
          closeSlashRef.current()
          return
        }
        const query = text.slice(1)
        if (slashQueryRef.current !== query) setSlashQuery(query)
      } catch (err) {
        if (slashQueryRef.current) setSlashQuery('')
      }
    }
    editor.on('update', updateSlashState)
    editor.on('selectionUpdate', updateSlashState)
    return () => {
      editor.off('update', updateSlashState)
      editor.off('selectionUpdate', updateSlashState)
    }
  }, [editor])

  useEffect(() => {
    if (slashOpen) {
      updateSlashActive(0)
      requestAnimationFrame(() => {
        slashInputRef.current?.focus()
        slashInputRef.current?.select()
      })
    }
  }, [slashOpen])

  useEffect(() => {
    if (!editor) return
    applySearchHighlight()
  }, [editor, applySearchHighlight, searchQuery])

  useEffect(() => {
    if (!editor) return
    const handler = () => applySearchHighlight()
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor, applySearchHighlight])

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
    function onDocMouseDown(e) {
      if (!slashOpen) return
      if (menuRef.current && !menuRef.current.contains(e.target)) { closeSlash(); pushDebug('popup: close by outside click') }
    }
    function onDocKeyDown(e) {
      if (!slashOpen) return
      const isNav = ['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)
      const insideMenu = menuRef.current && menuRef.current.contains(e.target)
      if (e.key === 'Escape') { closeSlash(); e.preventDefault(); pushDebug('popup: close by ESC') }
      else if (!insideMenu && !isNav && e.key.length === 1 && e.key !== '/' && e.key !== '?') {
        closeSlash();
        pushDebug('popup: close by typing', { key:e.key })
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [slashOpen])

  function moveIntoFirstChild(view) {
    const { state } = view
    const { $from } = state.selection
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'listItem') {
        const inPara = $from.parent.type.name === 'paragraph'
        const atEnd = $from.parentOffset === $from.parent.content.size
        const collapsed = node.attrs?.collapsed
        if (!inPara || !atEnd || collapsed) return false
        let childIndex = -1
        for (let i = 0; i < node.childCount; i++) {
          const ch = node.child(i)
          if (ch.type.name === 'bulletList' && ch.childCount > 0) { childIndex = i; break }
        }
        if (childIndex === -1) return false
        const liStart = $from.before(d)
        let offset = 1
        for (let i = 0; i < childIndex; i++) offset += node.child(i).nodeSize
        let firstLiStart = liStart + offset + 1
        const target = firstLiStart + 1
        const tr = state.tr.setSelection(TextSelection.create(state.doc, target))
        view.dispatch(tr.scrollIntoView())
        return true
      }
    }
    return false
  }

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
  }, [editor, forceExpand])

  const availableFilters = useMemo(() => ([
    { key: 'none', label: 'No status' },
    { key: 'todo', label: 'To do' },
    { key: 'in-progress', label: 'In progress' },
    { key: 'done', label: 'Done' }
  ]), [])

  const toggleStatusFilter = (key) => {
    const updated = { ...statusFilter, [key]: !statusFilter[key] }
    const keys = Object.keys(DEFAULT_STATUS_FILTER)
    const anyEnabled = keys.some(k => updated[k])
    const next = anyEnabled ? updated : { ...DEFAULT_STATUS_FILTER, done: false }
    try { saveStatusFilter(next) } catch {}
    statusFilterRef.current = next
    setStatusFilter(next)
  }

  const applyPresetFilter = (preset) => {
    if (preset === 'all') {
      const next = { ...DEFAULT_STATUS_FILTER }
      statusFilterRef.current = next
      setStatusFilter(next)
    } else if (preset === 'active') {
      const next = { none: true, todo: true, 'in-progress': true, done: false }
      statusFilterRef.current = next
      setStatusFilter(next)
    } else if (preset === 'completed') {
      const next = { none: false, todo: false, 'in-progress': false, done: true }
      statusFilterRef.current = next
      setStatusFilter(next)
    }
  }

  const addTagFilter = useCallback((mode, value) => {
    const parsed = parseTagInput(value)
    if (!parsed) return false
    let added = false
    setTagFilters(prev => {
      const current = prev && typeof prev === 'object'
        ? prev
        : { include: [], exclude: [] }
      const includeSet = new Set(Array.isArray(current.include) ? current.include : [])
      const excludeSet = new Set(Array.isArray(current.exclude) ? current.exclude : [])
      if (mode === 'include') {
        if (includeSet.has(parsed.canonical)) return current
        includeSet.add(parsed.canonical)
        excludeSet.delete(parsed.canonical)
      } else {
        if (excludeSet.has(parsed.canonical)) return current
        excludeSet.add(parsed.canonical)
        includeSet.delete(parsed.canonical)
      }
      added = true
      return {
        include: Array.from(includeSet).sort((a, b) => a.localeCompare(b)),
        exclude: Array.from(excludeSet).sort((a, b) => a.localeCompare(b))
      }
    })
    return added
  }, [])

  const removeTagFilter = useCallback((mode, tag) => {
    const canonical = typeof tag === 'string' ? tag.toLowerCase() : ''
    if (!canonical) return false
    let removed = false
    setTagFilters(prev => {
      const current = prev && typeof prev === 'object'
        ? prev
        : { include: [], exclude: [] }
      const include = Array.isArray(current.include) ? current.include : []
      const exclude = Array.isArray(current.exclude) ? current.exclude : []
      if (mode === 'include') {
        if (!include.includes(canonical)) return current
        removed = true
        return { include: include.filter(t => t !== canonical), exclude: [...exclude] }
      }
      if (!exclude.includes(canonical)) return current
      removed = true
      return { include: [...include], exclude: exclude.filter(t => t !== canonical) }
    })
    return removed
  }, [])

  const clearTagFilters = useCallback(() => {
    setTagFilters(prev => {
      const include = Array.isArray(prev?.include) ? prev.include : []
      const exclude = Array.isArray(prev?.exclude) ? prev.exclude : []
      if (!include.length && !exclude.length) return prev
      return { include: [], exclude: [] }
    })
    setIncludeTagInput('')
    setExcludeTagInput('')
  }, [])

  const handleTagInputChange = useCallback((mode) => (event) => {
    const value = event.target.value
    if (mode === 'include') setIncludeTagInput(value)
    else setExcludeTagInput(value)
  }, [])

  const handleTagInputKeyDown = useCallback((mode) => (event) => {
    const commitKeys = ['Enter', 'Tab', ',', ' ']
    if (commitKeys.includes(event.key)) {
      const value = event.currentTarget.value
      const added = addTagFilter(mode, value)
      if (added) {
        event.preventDefault()
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      } else if (event.key !== 'Tab') {
        // Prevent stray characters when value is empty or invalid
        event.preventDefault()
      }
      return
    }
    if (event.key === 'Backspace' && !event.currentTarget.value) {
      const current = tagFiltersRef.current || DEFAULT_TAG_FILTER
      const list = Array.isArray(current[mode]) ? current[mode] : []
      if (list.length) {
        event.preventDefault()
        removeTagFilter(mode, list[list.length - 1])
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      }
      return
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }, [addTagFilter, removeTagFilter])

  const handleTagInputBlur = useCallback((mode) => (event) => {
    const value = event.currentTarget.value
    const trimmed = value.trim()
    if (!trimmed) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
      return
    }
    const added = addTagFilter(mode, trimmed)
    if (added) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
    }
  }, [addTagFilter])

  const applyStatusFilter = useCallback(() => {
    if (!editor) return
    const root = editor.view.dom
    const hiddenClass = 'filter-hidden'
    const parentClass = 'filter-parent'
    const liNodes = Array.from(root.querySelectorAll('li.li-node'))
    const showFutureCurrent = showFutureRef.current
    const showSoonCurrent = showSoonRef.current
    const showArchivedCurrent = showArchivedRef.current
    const statusFilterCurrent = statusFilterRef.current || {}
    const tagFiltersCurrent = tagFiltersRef.current || DEFAULT_TAG_FILTER
    const includeTags = Array.isArray(tagFiltersCurrent.include) ? tagFiltersCurrent.include : []
    const excludeTags = Array.isArray(tagFiltersCurrent.exclude) ? tagFiltersCurrent.exclude : []
    const includeSet = new Set(includeTags.map(tag => String(tag || '').toLowerCase()))
    const excludeSet = new Set(excludeTags.map(tag => String(tag || '').toLowerCase()))
    const includeRequired = includeSet.size > 0
    const infoMap = new Map()
    const parentMap = new Map()
    const focusId = focusRootRef.current
    let focusElement = null
    if (focusId) {
      try {
        focusElement = root.querySelector(`li.li-node[data-id="${cssEscape(focusId)}"]`)
      } catch {
        focusElement = null
      }
    }

    const textNodeType = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3
    const elementNodeType = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1

    const readDirectBodyText = (bodyEl) => {
      if (!bodyEl) return ''
      const ownerLi = bodyEl.closest('li.li-node')
      const parts = []
      const visit = (node) => {
        if (!node) return
        if (node.nodeType === textNodeType) {
          const text = node.textContent
          if (text && text.trim()) parts.push(text)
          return
        }
        if (node.nodeType !== elementNodeType) return
        const el = node
        if (el.matches('ul,ol')) return
        if (ownerLi && el.closest('li.li-node') !== ownerLi) return
        if (el.matches('button, .li-reminder-area, .status-chip, .caret, .drag-toggle')) return
        if (el.hasAttribute('data-node-view-wrapper') || el.hasAttribute('data-node-view-content-react')) {
          el.childNodes.forEach(visit)
          return
        }
        if (el.childNodes && el.childNodes.length) {
          el.childNodes.forEach(visit)
          return
        }
        const text = el.textContent
        if (text && text.trim()) parts.push(text)
      }
      bodyEl.childNodes.forEach(visit)
      return parts.join(' ').replace(/\s+/g, ' ').trim()
    }

    liNodes.forEach(li => {
      li.classList.remove(hiddenClass, parentClass, 'focus-root', 'focus-descendant', 'focus-ancestor', 'focus-hidden')
      li.removeAttribute('data-focus-role')
      li.style.display = ''
      const row = li.querySelector(':scope > .li-row')
      if (row) row.style.display = ''

      const body = li.querySelector(':scope > .li-row .li-content')
      const attrBody = li.getAttribute('data-body-text')
      const bodyTextRaw = attrBody && attrBody.trim() ? attrBody : readDirectBodyText(body)
      const bodyText = bodyTextRaw.toLowerCase()
      const tagsFound = extractTagsFromText(bodyTextRaw)
      const canonicalTags = tagsFound.map(t => t.canonical)
      li.dataset.tagsSelf = canonicalTags.join(',')

      const selfArchived = /@archived\b/.test(bodyText)
      const selfFuture = /@future\b/.test(bodyText)
      const selfSoon = /@soon\b/.test(bodyText)

      li.dataset.archivedSelf = selfArchived ? '1' : '0'
      li.dataset.futureSelf = selfFuture ? '1' : '0'
      li.dataset.soonSelf = selfSoon ? '1' : '0'

      const parentLi = li.parentElement?.closest?.('li.li-node') || null
      parentMap.set(li, parentLi)

      const ownTagSet = new Set(canonicalTags)
      const includeSelf = includeRequired ? canonicalTags.some(tag => includeSet.has(tag)) : false
      const excludeSelf = canonicalTags.some(tag => excludeSet.has(tag))
      infoMap.set(li, {
        tags: ownTagSet,
        includeSelf,
        includeDescendant: false,
        includeAncestor: false,
        excludeSelf,
        excludeAncestor: false
      })
    })

    const liReverse = [...liNodes].reverse()
    liReverse.forEach(li => {
      const parent = parentMap.get(li)
      if (!parent) return
      const info = infoMap.get(li)
      const parentInfo = infoMap.get(parent)
      if (!info || !parentInfo) return
      if (info.includeSelf || info.includeDescendant) parentInfo.includeDescendant = true
    })

    liNodes.forEach(li => {
      const parent = parentMap.get(li)
      if (!parent) return
      const info = infoMap.get(li)
      const parentInfo = infoMap.get(parent)
      if (!info || !parentInfo) return
      if (parentInfo.includeSelf || parentInfo.includeAncestor) info.includeAncestor = true
      if (parentInfo.excludeSelf || parentInfo.excludeAncestor) info.excludeAncestor = true
    })

    liNodes.forEach(li => {
      const info = infoMap.get(li) || { tags: new Set(), includeSelf: false, includeDescendant: false, includeAncestor: false, excludeSelf: false, excludeAncestor: false }
      let archived = li.dataset.archivedSelf === '1'
      let future = li.dataset.futureSelf === '1'
      let soon = li.dataset.soonSelf === '1'
      let parent = li.parentElement
      while (!(archived && future && soon) && parent) {
        if (parent.matches && parent.matches('li.li-node')) {
          if (!archived && parent.dataset.archived === '1') archived = true
          if (!future && parent.dataset.future === '1') future = true
          if (!soon && parent.dataset.soon === '1') soon = true
          if (archived && future && soon) break
        }
        parent = parent.parentElement
      }
      li.dataset.archived = archived ? '1' : '0'
      li.dataset.future = future ? '1' : '0'
      li.dataset.soon = soon ? '1' : '0'

      const statusAttr = li.getAttribute('data-status') || ''
      const filterKey = statusAttr === '' ? 'none' : statusAttr
      const hideByStatus = statusFilterCurrent[filterKey] === false
      const hideByArchive = !showArchivedCurrent && archived
      const hideByFuture = !showFutureCurrent && future
      const hideBySoon = !showSoonCurrent && soon
      const includeVisible = includeRequired ? (info.includeSelf || info.includeDescendant || info.includeAncestor) : true
      const hideByInclude = includeRequired && !includeVisible
      const hideByExclude = info.excludeSelf || info.excludeAncestor
      const hideByTags = hideByInclude || hideByExclude
      li.dataset.tagInclude = includeVisible ? '1' : '0'
      li.dataset.tagExclude = hideByExclude ? '1' : '0'

      const isFocusActive = !!focusElement
      const isRoot = focusElement ? li === focusElement : false
      const isDescendant = focusElement ? (focusElement.contains(li) && li !== focusElement) : false
      const isAncestor = focusElement ? (!isRoot && li.contains(focusElement)) : false

      if (isFocusActive) {
        const role = isRoot ? 'root' : (isAncestor ? 'ancestor' : (isDescendant ? 'descendant' : 'other'))
        li.dataset.focusRole = role
        const row = li.querySelector(':scope > .li-row')
        if (row && role !== 'ancestor') row.style.display = ''
        if (role === 'root') li.classList.add('focus-root')
        if (role === 'ancestor') {
          li.classList.add('focus-ancestor')
        }
        if (role === 'descendant') li.classList.add('focus-descendant')
        if (role === 'other') {
          li.classList.add('focus-hidden')
          li.classList.remove(parentClass)
          li.classList.remove(hiddenClass)
          li.style.display = 'none'
          return
        }
      } else {
        li.removeAttribute('data-focus-role')
      }

      const shouldHide = (isFocusActive && (isRoot || isDescendant || isAncestor))
        ? false
        : (hideByStatus || hideByArchive || hideByFuture || hideBySoon || hideByTags)
      if (shouldHide) {
        li.classList.add(hiddenClass)
        li.style.display = 'none'
      } else {
        li.classList.remove(hiddenClass)
        li.style.display = ''
      }
    })

    const depthMap = new Map()
    const getDepth = (el) => {
      if (depthMap.has(el)) return depthMap.get(el)
      let depth = 0
      let current = el.parentElement
      while (current) {
        if (current.matches && current.matches('li.li-node')) depth += 1
        current = current.parentElement
      }
      depthMap.set(el, depth)
      return depth
    }

    const sorted = [...liNodes].sort((a, b) => getDepth(b) - getDepth(a))
    sorted.forEach(li => {
      if (focusElement) return
      if (!li.classList.contains(hiddenClass)) return
      const descendantVisible = li.querySelector('li.li-node:not(.filter-hidden)')
      if (descendantVisible) {
        li.classList.remove(hiddenClass)
        li.classList.add(parentClass)
      }
    })

  }, [editor, statusFilter, showArchived, showFuture, showSoon])

  const computeActiveTask = useCallback(() => {
    if (!editor) return null
    try {
      const { state } = editor
      if (!state) return null
      const { $from } = state.selection
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const node = $from.node(depth)
        if (!node || node.type?.name !== 'listItem') continue
        const dataId = node.attrs?.dataId ? String(node.attrs.dataId) : null
        const reminder = dataId ? remindersByTask.get(String(dataId)) || null : null
        const textContent = node.textContent || ''
        const dateMatches = textContent.match(/@\d{4}-\d{2}-\d{2}/g) || []
        const dates = Array.from(new Set(dateMatches.map(item => item.slice(1))))
        const hasDate = dates.length > 0
        const hasReminder = !!reminder
        const reminderDate = reminder?.remindAt ? dayjs(reminder.remindAt).format('YYYY-MM-DD') : null
        return {
          id: dataId,
          hasReminder,
          hasDate,
          dates,
          reminderDate,
          reminderId: reminder?.id || null,
          remindAt: reminder?.remindAt || null
        }
      }
    } catch {
      return null
    }
    return null
  }, [editor, remindersByTask])

  useEffect(() => {
    if (!editor) return undefined
    const notify = () => {
      const info = computeActiveTask()
      const prev = activeTaskInfoRef.current
      const prevKey = prev ? `${prev.id}|${prev.hasReminder}|${prev.hasDate}|${prev.reminderId}|${prev.reminderDate}|${(prev.dates || []).join(',')}` : ''
      const nextKey = info ? `${info.id}|${info.hasReminder}|${info.hasDate}|${info.reminderId}|${info.reminderDate}|${(info.dates || []).join(',')}` : ''
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
    saveTagFilters(tagFilters)
    applyStatusFilter()
  }, [tagFilters, applyStatusFilter])

  const handleRequestFocus = useCallback((taskId) => {
    if (!taskId) return
    const normalized = String(taskId)
    pendingFocusScrollRef.current = normalized
    setFocusRootId(prev => (prev === normalized ? prev : normalized))
  }, [])

  const focusTaskById = useCallback((taskId, { select = true } = {}) => {
    if (!editor || !taskId) return false
    try {
      const { state, view } = editor
      if (!state || !view) return false
      const doc = state.doc
      let targetPos = null
      let targetNode = null
      doc.descendants((node, pos) => {
        if (node.type.name === 'listItem' && String(node.attrs.dataId) === String(taskId)) {
          targetPos = pos
          targetNode = node
          return false
        }
        return undefined
      })
      if (targetNode == null || targetPos == null) return false
      const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(focusRootRef.current)
      const expandedIds = new Set()
      const $pos = doc.resolve(targetPos + 1)
      let tr = state.tr
      let mutated = false
      for (let depth = $pos.depth; depth >= 0; depth -= 1) {
        const node = $pos.node(depth)
        if (!node || node.type?.name !== 'listItem') continue
        const before = $pos.before(depth)
        if (node.attrs?.collapsed) {
          tr = tr.setNodeMarkup(before, undefined, { ...node.attrs, collapsed: false })
          mutated = true
        }
        const ancestorId = node.attrs?.dataId
        if (!forceExpand && ancestorId) expandedIds.add(String(ancestorId))
      }
      if (!forceExpand && expandedIds.size) {
        const next = new Set(collapsedSet)
        let changed = false
        expandedIds.forEach(id => {
          if (next.has(id)) {
            next.delete(id)
            changed = true
          }
        })
        if (changed) saveCollapsedSetForRoot(focusRootRef.current, next)
      }
      if (select) {
        const firstChild = targetNode.childCount > 0 ? targetNode.child(0) : null
        const paragraph = firstChild && firstChild.type?.name === 'paragraph' ? firstChild : null
        const paragraphStart = targetPos + 1
        const selectionPos = paragraph ? paragraphStart + paragraph.nodeSize - 1 : paragraphStart
        tr = tr.setSelection(TextSelection.create(tr.doc, Math.max(paragraphStart, selectionPos)))
      }
      view.dispatch(tr.scrollIntoView())
      view.focus()
      const centerTask = () => {
        if (typeof window === 'undefined') return
        try {
          const rootEl = view.dom
          if (!rootEl) return
          let targetEl = null
          try {
            targetEl = rootEl.querySelector(`li.li-node[data-id="${cssEscape(String(taskId))}"]`)
          } catch {
            targetEl = null
          }
          if (!targetEl) return
          const rect = targetEl.getBoundingClientRect()
          const viewportCenter = window.innerHeight / 2
          const scrollTarget = (rect.top + window.scrollY) - (viewportCenter - rect.height / 2)
          window.scrollTo({ top: Math.max(scrollTarget, 0), behavior: 'smooth' })
          targetEl.classList.add('outline-focus-highlight')
          setTimeout(() => targetEl.classList.remove('outline-focus-highlight'), 1200)
        } catch (err) {
          console.error('[outline] focus scroll failed', err)
        }
      }
      requestAnimationFrame(centerTask)
      setTimeout(() => applyStatusFilter(), 50)
      return true
    } catch (err) {
      console.error('[outline] failed to focus task', err)
      return false
    }
  }, [editor, forceExpand, applyStatusFilter])

  const requestFocusRef = useRef(handleRequestFocus)
  useEffect(() => { requestFocusRef.current = handleRequestFocus }, [handleRequestFocus])

  useEffect(() => {
    if (!focusRequest || !focusRequest.taskId || !editor) return undefined
    const token = focusRequest.token ?? `${focusRequest.taskId}:${focusRequest.reminderId ?? ''}:${focusRequest.remindAt ?? ''}`
    if (lastFocusTokenRef.current === token) return undefined
    lastFocusTokenRef.current = token
    const success = focusTaskById(focusRequest.taskId, { select: focusRequest.select !== false })
    if (success) {
      const info = computeActiveTask()
      activeTaskInfoRef.current = info
    }
    onFocusHandled?.(success)
  }, [focusRequest, editor, focusTaskById, onFocusHandled, computeActiveTask])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handler = (event) => {
      if (!(event instanceof MouseEvent)) return
      if (event.type === 'mousedown' && event.button !== 0) return
      const usingModifier = event.metaKey || (event.ctrlKey && !event.metaKey)
      if (!usingModifier) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('a')) return
      const li = target instanceof HTMLElement ? target.closest('li.li-node') : null
      if (!li) return
      const id = li.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      requestFocusRef.current?.(String(id))
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('click', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('click', handler, true)
    }
  }, [])

  const exitFocus = useCallback(() => {
    if (!focusRootRef.current) return
    pendingFocusScrollRef.current = null
    setFocusRootId(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const next = readFocusFromLocation()
      suppressUrlSyncRef.current = true
      setFocusRootId(next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [readFocusFromLocation])

  useEffect(() => {
    if (initialFocusSyncRef.current) {
      initialFocusSyncRef.current = false
      return
    }
    if (suppressUrlSyncRef.current) {
      suppressUrlSyncRef.current = false
      return
    }
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      if (focusRootId) url.searchParams.set('focus', focusRootId)
      else url.searchParams.delete('focus')
      window.history.pushState({ focus: focusRootId }, '', url)
    } catch {}
  }, [focusRootId])

  const computeFocusTitle = useCallback((targetId) => {
    if (!editor || !targetId) return ''
    try {
      const json = editor.getJSON()
      let title = ''
      const visit = (node) => {
        if (!node || !node.content) return false
        for (const child of node.content) {
          if (child.type === 'listItem') {
            const dataId = child.attrs?.dataId
            if (String(dataId) === String(targetId)) {
              const body = child.content || []
              const paragraph = body.find(n => n.type === 'paragraph')
              title = extractTitle(paragraph)
              return true
            }
            for (const nested of child.content || []) {
              if (nested.type === 'bulletList' && visit(nested)) return true
            }
          } else if (child.type === 'bulletList' && visit(child)) {
            return true
          }
        }
        return false
      }
      visit(json)
      return title || ''
    } catch {
      return ''
    }
  }, [editor])

  const updateFocusTitle = useCallback(() => {
    const currentId = focusRootRef.current
    if (!currentId) {
      setFocusTitle('')
      return
    }
    const title = computeFocusTitle(currentId)
    setFocusTitle(title)
  }, [computeFocusTitle])

  useEffect(() => {
    applyStatusFilter()
  }, [applyStatusFilter])
  useEffect(() => { applyStatusFilterRef.current = applyStatusFilter }, [applyStatusFilter])

  useEffect(() => {
    if (!editor) return
    const handler = () => applyStatusFilter()
    editor.on('update', handler)
    return () => editor.off?.('update', handler)
  }, [editor, applyStatusFilter])
  // Observe DOM changes to ensure filters apply when NodeViews finish mounting (first load, etc.)
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    let t = null
    const observer = new MutationObserver(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        applyStatusFilter()
      }, 50)
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (t) clearTimeout(t) }
  }, [editor, applyStatusFilter])


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

  async function doSave() {
    if (!editor || isReadOnly) return
    if (savingRef.current) return
    pushDebug('save: begin')
    savingRef.current = true
    setSaving(true)
    try {
      dirtyRef.current = false
      const { doc } = editor.state
      let tr = editor.state.tr, changed = false
      const seenIds = new Set()
      doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem') return
        const currentId = node.attrs.dataId
        if (!currentId || seenIds.has(currentId)) {
          const tmp = 'new-' + Math.random().toString(36).slice(2,8)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: tmp });
          seenIds.add(tmp)
          changed = true
        } else {
          seenIds.add(currentId)
        }
      })
      if (changed) { tr.setMeta('addToHistory', false); editor.view.dispatch(tr) }
      const outline = parseOutline()
      pushDebug('save: parsed outline', { count: outline.length, titles: outline.map(n => n.title) })
      const data = await saveOutlineApi(outline)
      pushDebug('save: server reply', data)
      const mapping = data?.newIdMap || {}
      if (Object.keys(mapping).length) {
        pushDebug('save: applying id mapping', mapping)
        const { doc } = editor.state
        let tr2 = editor.state.tr, changed2 = false
        doc.descendants((node, pos) => {
          if (node.type.name === 'listItem') {
            const id = node.attrs.dataId
            if (mapping[id]) { tr2.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: String(mapping[id]) }); changed2 = true }
          }
        })
        if (changed2) { tr2.setMeta('addToHistory', false); editor.view.dispatch(tr2) }
        migrateCollapsedSets(mapping)
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
      }
      // Skip immediate refresh to avoid resetting the caret while editing
      if (!dirtyRef.current) setDirty(false)
      pushDebug('save: complete')
    } catch (e) {
      console.error('[save] failed:', e)
      pushDebug('save: error', { message: e.message, stack: e.stack })
    } finally {
      savingRef.current = false
      setSaving(false)
      if (dirtyRef.current) {
        pushDebug('save: rerun pending dirty state')
        queueSave(300)
      }
    }
  }

  useEffect(() => {
    if (!editor || !isReadOnly) return
    if (!initialOutline) return
    const roots = Array.isArray(initialOutline?.roots)
      ? initialOutline.roots
      : Array.isArray(initialOutline)
        ? initialOutline
        : (initialOutline?.roots || [])
    const doc = { type: 'doc', content: [buildList(roots)] }
    editor.commands.setContent(doc)
    dirtyRef.current = false
    setDirty(false)
    applyStatusFilter()
  }, [editor, initialOutline, isReadOnly, applyStatusFilter])


  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onCopy = (e) => {
      try {
        const { state } = editor.view
        const { doc, selection, schema } = state
        if (selection.empty) return
        const sliceDoc = doc.cut(selection.from, selection.to)
        const json = sliceDoc.toJSON()
        const serializer = DOMSerializer.fromSchema(schema)
        const fragment = serializer.serializeFragment(sliceDoc.content)
        const container = document.createElement('div')
        container.appendChild(fragment)
        const html = container.innerHTML
        const selectionText = window.getSelection()?.toString() || sliceDoc.textContent || ''

        e.clipboardData?.setData('application/x-worklog-outline+json', JSON.stringify(json))
        e.clipboardData?.setData('text/html', html)
        e.clipboardData?.setData('text/plain', selectionText)
        if (typeof window !== 'undefined') {
          window.__WORKLOG_TEST_COPY__ = { text: selectionText, json: JSON.stringify(json) }
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
      dirtyRef.current = false
      setDirty(false)
      pushDebug('loaded outline', { roots: roots.length })
      applyCollapsedStateForRoot(focusRootRef.current)
      // Ensure filters (status/archive) apply on first load
      setTimeout(() => {
        applyStatusFilter()
      }, 50)
      setTimeout(() => {
        if (restoredScrollRef.current) return
        const state = loadScrollState()
        if (state && typeof state.scrollY === 'number') {
          window.scrollTo({ top: state.scrollY, behavior: 'auto' })
        }
        restoredScrollRef.current = true
      }, 120)
    })()
  }, [editor, isReadOnly, applyCollapsedStateForRoot, applyStatusFilter])

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
        setTimeout(() => applyStatusFilter(), 50)
      }
    }
    window.addEventListener('worklog:task-status-change', handler)
    return () => window.removeEventListener('worklog:task-status-change', handler)
  }, [editor, applyStatusFilter])

  function normalizeBodyNodes(nodes) {
    return nodes.map(node => {
      const copy = { ...node }
      if (copy.type === 'image') {
        copy.attrs = { ...copy.attrs, src: normalizeImageSrc(copy.attrs?.src) }
      }
      if (copy.content) copy.content = normalizeBodyNodes(copy.content)
      return copy
    })
  }

  function parseBodyContent(raw) {
    if (!raw) return []
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(parsed) ? normalizeBodyNodes(parsed) : []
    } catch {
      return []
    }
  }

  function defaultBody(titleText, dateTokens, hasExtras) {
    if (!hasExtras && (!dateTokens || !dateTokens.length)) {
      return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
    }
    const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
    if (dateTokens?.length) {
      textContent.push({ type: 'text', text: ' ' + dateTokens.map(d => '@' + d).join(' ') })
    }
    return [{ type: 'paragraph', content: textContent }]
  }

  function buildList(nodes) {
    const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(null)
    if (!nodes || !nodes.length) {
      return {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          attrs: { dataId: null, status: STATUS_EMPTY, collapsed: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: STARTER_PLACEHOLDER_TITLE }] }]
        }]
      }
    }
    return {
      type: 'bulletList',
      content: nodes.map(n => {
        const titleText = n.title || 'Untitled'
        const ownDates = Array.isArray(n.ownWorkedOnDates) ? n.ownWorkedOnDates : []
        const rawBody = n.content ?? n.body ?? []
        const body = parseBodyContent(rawBody)
        const hasExtras = body.some(node => node.type !== 'paragraph' || (node.content || []).some(ch => ch.type !== 'text'))
        const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)
        const children = [...bodyContent]
        if (n.children?.length) children.push(buildList(n.children))
        const idStr = String(n.id)
        const titleLower = (titleText || '').toLowerCase()
        const bodyLower = JSON.stringify(bodyContent || []).toLowerCase()
        const archivedSelf = titleLower.includes('@archived') || bodyLower.includes('@archived')
        const futureSelf = titleLower.includes('@future') || bodyLower.includes('@future')
        const soonSelf = titleLower.includes('@soon') || bodyLower.includes('@soon')
        const tags = Array.isArray(n.tags) ? n.tags.map(tag => String(tag || '').toLowerCase()) : []
        return {
          type: 'listItem',
          attrs: { dataId: n.id, status: n.status ?? STATUS_EMPTY, collapsed: collapsedSet.has(idStr), archivedSelf, futureSelf, soonSelf, tags },
          content: children
        }
      })
    }
  }

  function parseOutline() {
    const doc = editor.getJSON(); const results = []
    function walk(node, collector) {
      if (!node?.content) return
      const lists = node.type === 'bulletList' ? [node] : (node.content || []).filter(c => c.type === 'bulletList')
      for (const bl of lists) {
        for (const li of (bl.content || [])) {
          if (li.type !== 'listItem') continue
          const bodyNodes = []
          let subList = null
          ;(li.content || []).forEach(n => {
            if (n.type === 'bulletList' && !subList) subList = n
            else bodyNodes.push(n)
          })
          const para = bodyNodes.find(n => n.type === 'paragraph')
          const title = extractTitle(para)
          const dates = extractDates(li)
          const id = li.attrs?.dataId || null
          const status = li.attrs?.status ?? STATUS_EMPTY
          const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }
          if (bodyNodes.length) {
            try {
              const cloned = JSON.parse(JSON.stringify(bodyNodes))
              item.body = normalizeBodyNodes(cloned)
            } catch {
              item.body = normalizeBodyNodes(bodyNodes)
            }
            item.content = item.body
            pushDebug('parse: captured body', { id, body: item.body })
          }
          collector.push(item)
          if (subList) walk(subList, item.children)
        }
      }
    }
    walk(doc, results)
    return results
  }

  const cloneOutline = (outline) => (typeof structuredClone === 'function'
    ? structuredClone(outline)
    : JSON.parse(JSON.stringify(outline)))

  function moveNodeInOutline(nodes, dragId, targetId, position = 'before') {
    console.log('[drop] moveNodeInOutline', { dragId, targetId, position })
    if (!dragId || dragId === targetId) return null
    const clone = cloneOutline(nodes)
    const removedInfo = removeNodeById(clone, dragId)
    if (!removedInfo?.node) {
      console.log('[drop] move failed to find dragged node', { dragId })
      return null
    }
    const removed = removedInfo.node
    if (!targetId) {
      clone.push(removed)
      return clone
    }
    if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
      console.log('[drop] insert fallback to end', { dragId, targetId })
      clone.push(removed)
    }
    return clone
  }

  function removeNodeById(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (String(node.id) === String(id)) {
        return { node: nodes.splice(i, 1)[0], index: i }
      }
      if (node.children) {
        const result = removeNodeById(node.children, id)
        if (result?.node) return result
      }
    }
    return { node: null }
  }

  function insertNodeRelative(nodes, targetId, newNode, after) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (String(node.id) === String(targetId)) {
        nodes.splice(after ? i + 1 : i, 0, newNode)
        return true
      }
      if (node.children && insertNodeRelative(node.children, targetId, newNode, after)) return true
    }
    return false
  }

  function extractTitle(paragraphNode) {
    let text = ''
    if (paragraphNode?.content) paragraphNode.content.forEach(n => { if (n.type === 'text') text += n.text })
    return text.replace(DATE_RE, '').replace(/\s{2,}/g, ' ').trim() || 'Untitled'
  }
  function extractDates(listItemNode) {
    const dates = new Set()
    ;(listItemNode.content || []).forEach(n => {
      if (n.type === 'paragraph' && n.content) {
        let t = ''; n.content.forEach(m => { if (m.type === 'text') t += m.text })
        ;(t.match(DATE_RE) || []).forEach(s => dates.add(s.slice(1)))
      }
    })
    return Array.from(dates)
  }

  const closeSlash = ({ preserveMarker = false } = {}) => {
    if (!preserveMarker) {
      const marker = slashMarker.current
      if (marker && editor) {
        const cursorPos = marker.pos + 1 + slashQueryRef.current.length
        editor.chain().setTextSelection(cursorPos).focus().run()
      } else if (editor) {
        editor.chain().focus().run()
      }
      slashMarker.current = null
      updateSlashActive(0)
      setSlashQuery('')
    }
    setSlashOpen(false)
  }
  closeSlashRef.current = closeSlash
  const consumeSlashMarker = useCallback(() => {
    if (!editor) return null
    const query = slashQueryRef.current
    const { state } = editor
    const { $from } = state.selection
    const queryLength = query.length
    const suffix = `/${query}`
    let from = null
    let to = null
    let source = 'cursor'

    if ($from.parent?.isTextblock) {
      try {
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\uFFFC', '\uFFFC')
        if (textBefore && textBefore.endsWith(suffix)) {
          const startOffset = $from.parentOffset - suffix.length
          if (startOffset >= 0) {
            from = $from.start() + startOffset
            to = from + suffix.length
          }
        }
      } catch (err) {
        pushDebug('popup: inspect textBefore failed', { error: err.message })
      }
    }

    if (from === null) {
      const marker = slashMarker.current
      if (!marker) {
        pushDebug('popup: no slash marker to consume')
        setSlashQuery('')
        return null
      }
      from = marker.pos
      const docSize = state.doc.content.size
      const probeEnd = Math.min(marker.pos + 1 + query.length, docSize)
      const slice = state.doc.textBetween(marker.pos, probeEnd, '\n', '\n') || ''
      if (queryLength && slice.startsWith('/' + query)) {
        to = marker.pos + 1 + queryLength
      } else {
        to = marker.pos + 1
      }
      source = 'marker'
    }

    let removed = null
    try {
      pushDebug('popup: doc before slash removal', { doc: editor.getJSON() })
      const ok = editor.chain().focus().deleteRange({ from, to }).run()
      if (ok) {
        removed = { from, to }
        pushDebug('popup: removed slash marker', { from, to, source })
      } else {
        pushDebug('popup: remove slash marker skipped', { from, to, source })
      }
      pushDebug('popup: doc after slash removal', { doc: editor.getJSON() })
    } catch (e) {
      pushDebug('popup: remove slash marker failed', { error: e.message })
    }

    slashMarker.current = null
    setSlashQuery('')
    return removed
  }, [editor, pushDebug])

  const cleanDanglingSlash = useCallback((from) => {
    if (!editor) return
    const char = editor.state.doc.textBetween(from, from + 1, '\n', '\n')
    if (char !== '/') return
    try {
      editor.chain().focus().deleteRange({ from, to: from + 1 }).run()
      pushDebug('popup: cleaned dangling slash', { from })
    } catch (e) {
      pushDebug('popup: clean dangling slash failed', { error: e.message })
    }
  }, [editor])

  // Ensure slash commands that add block nodes (code, details, etc.) stay inside the current list item
  const insertBlockNodeInList = useCallback((nodeName, attrs = {}, options = {}) => {
    if (!editor) return false
    const { select = 'after' } = options
    return editor.chain().focus().command(({ state, dispatch, tr, commands }) => {
      const type = state.schema.nodes[nodeName]
      if (!type) return false
      const { $from } = state.selection

      let listItemDepth = -1
      for (let depth = $from.depth; depth >= 0; depth--) {
        if ($from.node(depth).type.name === 'listItem') {
          listItemDepth = depth
          break
        }
      }

      if (listItemDepth === -1) {
        return commands.insertContent({ type: nodeName, attrs })
      }

      let contentNode = null
      const defaultType = type.contentMatch?.defaultType
      if (defaultType) {
        if (defaultType.isText) {
          contentNode = state.schema.text('')
        } else {
          contentNode = defaultType.create()
        }
      }

      const newNode = type.create(attrs, contentNode ? [contentNode] : undefined)

      let blockDepth = -1
      for (let depth = $from.depth; depth > listItemDepth; depth--) {
        const current = $from.node(depth)
        if (current.isBlock) {
          blockDepth = depth
          break
        }
      }

      const insertPos = blockDepth >= 0
        ? $from.after(blockDepth)
        : $from.end(listItemDepth)

      tr.insert(insertPos, newNode)

      if (!dispatch) return true

      const targetPos = select === 'inside'
        ? insertPos + 1
        : insertPos + newNode.nodeSize

      try {
        tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos), 1))
      } catch (err) {
        try {
          tr.setSelection(TextSelection.create(tr.doc, targetPos))
        } catch {
          tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size), -1))
        }
      }

      dispatch(tr.scrollIntoView())
      pushDebug('insert block node', {
        nodeName,
        insertPos,
        select,
        listItemDepth,
        blockDepth,
        from: $from.pos
      })
      return true
    }).run()
  }, [editor, pushDebug])
  const insertToday = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @' + dayjs().format('YYYY-MM-DD')).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert date today')
  }
  const insertPick = () => {
    // Open our own lightweight date picker popup instead of browser prompt
    const today = dayjs().format('YYYY-MM-DD')
    datePickerValueRef.current = today
    const selFrom = editor?.state?.selection?.from ?? null
    datePickerCaretRef.current = selFrom

    setDatePickerOpen(true)
    closeSlash({ preserveMarker: true })
  }
  const insertArchived = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @archived').run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert archived tag')
  }
  const insertFuture = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @future').run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert future tag')
  }
  const insertSoon = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @soon').run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert soon tag')
  }

  const insertTagFromSlash = useCallback((tagInfo) => {
    if (!tagInfo) return
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    let insertion = `#${tagInfo.display}`
    try {
      const { doc } = editor?.state || {}
      const pos = caretPos ?? 0
      if (doc && pos > 0) {
        const prevChar = doc.textBetween(pos - 1, pos, '\n', '\n') || ''
        if (prevChar && !/\s/.test(prevChar)) insertion = ' ' + insertion
      }
    } catch {}
    editor?.chain().focus().insertContent(insertion).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert tag', { tag: tagInfo.canonical })
  }, [editor, consumeSlashMarker, cleanDanglingSlash, closeSlash, pushDebug])


  const insertCode = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    const inserted = insertBlockNodeInList('codeBlock', {}, { select: 'inside' })
    if (inserted) {
      pushDebug('doc after code insert', { doc: editor.getJSON() })
    } else {
      pushDebug('insert code block fallback')
      editor.chain().focus().insertContent({ type: 'codeBlock' }).run()
    }
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert code block')
  }
  const applyPickedDate = useCallback(() => {
    const v = datePickerValueRef.current
    setDatePickerOpen(false)
    if (!v) return
    const caretPos = datePickerCaretRef.current ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + v).run()
    if (slashMarker.current?.pos != null) cleanDanglingSlash(slashMarker.current.pos)
    pushDebug('insert date picked', { v })
  }, [editor, pushDebug])
  const insertImage = async () => {
    const input = document.createElement('input'); input.type='file'; input.accept='image/*'
    closeSlash({ preserveMarker: true })
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return
      const removed = consumeSlashMarker()
      const result = await uploadImage(f)
      const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
      if (caretPos !== null) {
        editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
      }
      const normalized = normalizeImageSrc(result.url)
      const attrs = { src: normalized }
      if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
      if (result?.id) attrs['data-file-id'] = result.id
      editor.chain().focus().setImage(attrs).run()
      if (removed) cleanDanglingSlash(removed.from)
      pushDebug('insert image', { url: normalized, id: result?.id })
      closeSlash()
    }
    input.click()
  }
  const insertDetails = () => {
    const removed = consumeSlashMarker()
    const inserted = insertBlockNodeInList('detailsBlock')
    if (!inserted) editor.chain().focus().insertContent({ type: 'detailsBlock' }).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert details block')
  }

  const baseSlashCommands = useMemo(() => ([
    { id: 'today', label: 'Date worked on (today)', hint: 'Insert @YYYY-MM-DD for today', keywords: ['today', 'date', 'now'], run: insertToday },
    { id: 'date', label: 'Date worked on (pick)', hint: 'Prompt for a specific date', keywords: ['date', 'pick', 'calendar'], run: insertPick },
    { id: 'archived', label: 'Archive (tag)', hint: 'Insert @archived tag to mark item (and its subtasks) archived', keywords: ['archive','archived','hide'], run: insertArchived },
    { id: 'future', label: 'Future (tag)', hint: 'Insert @future tag to mark item not planned soon (and its subtasks)', keywords: ['future','later','snooze'], run: insertFuture },
    { id: 'soon', label: 'Soon (tag)', hint: 'Insert @soon tag to mark item coming sooner than future (and its subtasks)', keywords: ['soon','next','upcoming'], run: insertSoon },
    { id: 'code', label: 'Code block', hint: 'Insert a multiline code block', keywords: ['code', 'snippet', '```'], run: insertCode },
    { id: 'image', label: 'Upload image', hint: 'Upload and insert an image', keywords: ['image', 'photo', 'upload'], run: insertImage },
    { id: 'details', label: 'Details (inline)', hint: 'Collapsible details block', keywords: ['details', 'summary', 'toggle'], run: insertDetails }
  ]), [insertToday, insertPick, insertArchived, insertFuture, insertSoon, insertCode, insertImage, insertDetails])

  const parsedTagQuery = useMemo(() => {
    const trimmed = slashQuery.trim()
    if (!trimmed || !trimmed.startsWith('#')) return null
    return parseTagInput(trimmed)
  }, [slashQuery])

  const dynamicTagCommand = useMemo(() => {
    if (!parsedTagQuery) return null
    return {
      id: `tag:${parsedTagQuery.canonical}`,
      label: `Add tag #${parsedTagQuery.display}`,
      hint: 'Insert a tag for this task',
      keywords: ['tag', 'hash', parsedTagQuery.canonical],
      run: () => insertTagFromSlash(parsedTagQuery)
    }
  }, [parsedTagQuery, insertTagFromSlash])

  const slashCommands = useMemo(() => (
    dynamicTagCommand ? [dynamicTagCommand, ...baseSlashCommands] : baseSlashCommands
  ), [dynamicTagCommand, baseSlashCommands])

  const normalizedSlashQuery = slashQuery.trim().toLowerCase()
  const filteredCommands = useMemo(() => {
    const terms = normalizedSlashQuery.split(/\s+/g).filter(Boolean)
    if (!terms.length) return slashCommands
    const scored = []
    slashCommands.forEach((cmd, index) => {
      const label = cmd.label.toLowerCase()
      const keywords = (cmd.keywords || []).map(k => k.toLowerCase())
      let matches = true
      let score = 0
      for (const term of terms) {
        const labelMatch = label.includes(term)
        const keywordExact = keywords.includes(term)
        const keywordMatch = keywordExact || keywords.some(k => k.includes(term))
        if (!labelMatch && !keywordMatch) { matches = false; break }
        if (keywordExact) score += 3
        else if (keywordMatch) score += 2
        if (labelMatch) score += 1
      }
      if (matches) scored.push({ cmd, score, index })
    })
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
    return scored.map(item => item.cmd)
  }, [normalizedSlashQuery, slashCommands])

  filteredCommandsRef.current = filteredCommands

  useEffect(() => {
    if (!filteredCommands.length) {
      updateSlashActive(0)
    } else if (slashSelectedRef.current >= filteredCommands.length) {
      updateSlashActive(0)
    }
  }, [filteredCommands, updateSlashActive])

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
    if (!editor) return
    const handler = () => updateFocusTitle()
    editor.on('update', handler)
    updateFocusTitle()
    return () => editor.off('update', handler)
  }, [editor, updateFocusTitle])

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
        <div className="status-filter-bar">
          <span className="meta" style={{ marginRight: 8 }}>Show:</span>
          {availableFilters.map(opt => (
            <button
              key={opt.key}
              className={`btn pill ${statusFilter[opt.key] ? 'active' : ''}`}
              data-status={opt.key}
              type="button"
              onClick={() => toggleStatusFilter(opt.key)}
            >{opt.label}</button>
          ))}
          <div className="filter-presets">
            <button className="btn ghost" type="button" onClick={() => applyPresetFilter('all')}>All</button>
            <button className="btn ghost" type="button" onClick={() => applyPresetFilter('active')}>Active</button>
            <button className="btn ghost" type="button" onClick={() => applyPresetFilter('completed')}>Completed</button>
          </div>
          <div className="archive-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="meta">Archived:</span>
            <button
              className={`btn pill ${showArchived ? 'active' : ''}`}
              type="button"
              onClick={() => {
                const next = !showArchived
                try { saveArchivedVisible(next) } catch {}
                showArchivedRef.current = next
                setShowArchived(next)
              }}
            >{showArchived ? 'Shown' : 'Hidden'}</button>
          </div>
          <div className="future-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="meta">Future:</span>
            <button
              className={`btn pill ${showFuture ? 'active' : ''}`}
              type="button"
              onClick={() => {
                const next = !showFuture
                try { saveFutureVisible(next) } catch {}
                showFutureRef.current = next
                setShowFuture(next)
              }}
            >{showFuture ? 'Shown' : 'Hidden'}</button>
          </div>
          <div className="soon-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="meta">Soon:</span>
            <button
              className={`btn pill ${showSoon ? 'active' : ''}`}
              type="button"
              onClick={() => {
                const next = !showSoon
                try { saveSoonVisible(next) } catch {}
                showSoonRef.current = next
                setShowSoon(next)
                queueMicrotask(() => {
                  try {
                    if (next && editor?.view?.dom) {
                      const root = editor.view.dom
                      root.querySelectorAll('li.li-node[data-soon="1"]').forEach(li => {
                        li.classList.remove('filter-hidden')
                        li.style.display = ''
                      })
                    }
                    applyStatusFilterRef.current?.()
                  } catch {}
                })
              }}
            >{showSoon ? 'Shown' : 'Hidden'}</button>
          </div>
          <div className="tag-filter-group">
            <div className="tag-filter include">
              <span className="meta">With:</span>
              {includeFilterList.map(tag => (
                <button
                  key={`tag-include-${tag}`}
                  type="button"
                  className="tag-chip"
                  onClick={() => removeTagFilter('include', tag)}
                  aria-label={`Remove include filter #${tag}`}
                >
                  #{tag}<span aria-hidden className="tag-chip-remove">×</span>
                </button>
              ))}
              <input
                ref={includeInputRef}
                className="tag-input"
                type="text"
                value={includeTagInput}
                placeholder="#tag"
                onChange={handleTagInputChange('include')}
                onKeyDown={handleTagInputKeyDown('include')}
                onBlur={handleTagInputBlur('include')}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="tag-filter exclude">
              <span className="meta">Without:</span>
              {excludeFilterList.map(tag => (
                <button
                  key={`tag-exclude-${tag}`}
                  type="button"
                  className="tag-chip"
                  onClick={() => removeTagFilter('exclude', tag)}
                  aria-label={`Remove exclude filter #${tag}`}
                >
                  #{tag}<span aria-hidden className="tag-chip-remove">×</span>
                </button>
              ))}
              <input
                ref={excludeInputRef}
                className="tag-input"
                type="text"
                value={excludeTagInput}
                placeholder="#tag"
                onChange={handleTagInputChange('exclude')}
                onKeyDown={handleTagInputKeyDown('exclude')}
                onBlur={handleTagInputBlur('exclude')}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            {hasTagFilters && (
              <button type="button" className="btn ghost" onClick={clearTagFilters}>Clear</button>
            )}
          </div>
          <div className="search-bar">
            <input
              type="search"
              value={searchQuery}
              placeholder="Search outline…"
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')}>Clear</button>
            )}
          </div>
        </div>
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
