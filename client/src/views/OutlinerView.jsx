
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
import { parseTagInput, extractTagsFromText } from './outliner/tagUtils.js'
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
const COLLAPSED_KEY = 'worklog.collapsed'
const FILTER_STATUS_KEY = 'worklog.filter.status'
const FILTER_ARCHIVED_KEY = 'worklog.filter.archived'
const FILTER_FUTURE_KEY = 'worklog.filter.future'
const FILTER_SOON_KEY = 'worklog.filter.soon'
const SCROLL_STATE_KEY = 'worklog.lastScroll'
const STARTER_PLACEHOLDER_TITLE = 'Start here'

const FILTER_TAG_INCLUDE_KEY = 'worklog.filter.tags.include'
const FILTER_TAG_EXCLUDE_KEY = 'worklog.filter.tags.exclude'
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
  return stripReminderDisplayBreaks(parts.join(' '))
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

const findListItemDepth = ($pos) => {
  if (!$pos) return -1
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    if ($pos.node(depth)?.type?.name === 'listItem') return depth
  }
  return -1
}


const runListIndentCommand = (editor, direction, focusEmptyCallback) => {
  if (!editor) return false
  const { state, view } = editor
  if (!view) return false

  if (direction === 'lift') {
    const lifted = editor.chain().focus().liftListItem('listItem').run()
    if (lifted) {
      view.focus()
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => view.focus())
      }
    }
    return lifted
  }

  const listItemType = state.schema.nodes.listItem
  if (!listItemType) return false
  const { $from, $to } = state.selection
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild?.type === listItemType)
  if (!range) return false
  const startIndex = range.startIndex
  if (startIndex === 0) return false
  const parent = range.parent
  const nodeBefore = parent.child(startIndex - 1)
  if (nodeBefore.type !== listItemType) return false

  const nestedBefore = nodeBefore.lastChild && nodeBefore.lastChild.type === parent.type
  const inner = Fragment.from(nestedBefore ? listItemType.create() : null)
  const slice = new Slice(
    Fragment.from(
      listItemType.create(null, Fragment.from(parent.type.create(null, inner)))
    ),
    nestedBefore ? 3 : 1,
    0
  )
  const before = range.start
  const after = range.end
  const originalFrom = state.selection.from
  const tr = state.tr
  tr.step(new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true))

  const mapped = tr.mapping.map(originalFrom, 1)
  const nextSelection = TextSelection.near(tr.doc.resolve(mapped))
  tr.setSelection(nextSelection).scrollIntoView()
  view.dispatch(tr)
  // focusEmptyCallback intentionally unused; keeping signature for future adjustments
  view.focus()
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => view.focus())
  }
  return true
}

const positionOfListChild = (parentNode, parentPos, childIndex) => {
  if (!parentNode || typeof parentPos !== 'number') return null
  if (childIndex < 0 || childIndex >= parentNode.childCount) return null
  let pos = parentPos + 1
  for (let i = 0; i < parentNode.childCount; i += 1) {
    if (i === childIndex) return pos
    pos += parentNode.child(i).nodeSize
  }
  return null
}

const runSplitListItemWithSelection = (editor, options = {}) => {
  if (!editor) return false
  const listItemType = editor.schema.nodes.listItem
  const bulletListType = editor.schema.nodes.bulletList
  if (!listItemType) return false
  if (typeof window !== 'undefined') window.__WL_LAST_SPLIT = { reason: 'start' }
  const { state, view } = editor
  const { selection } = state
  const { $from } = selection
  const listItemDepth = findListItemDepth($from)
  if (listItemDepth === -1) return false
  const listItemPos = $from.before(listItemDepth)
  const listItemNode = $from.node(listItemDepth)
  if (!listItemNode) return false
  const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
  const listParent = parentDepth !== null ? $from.node(parentDepth) : null
  const parentPos = parentDepth !== null ? $from.before(parentDepth) : null
  const itemIndex = $from.index(listItemDepth)
  const splitAtStart = !!options.splitAtStart
  let performed = false
  const splitSuccess = splitListItem(listItemType)(state, (tr) => {
    performed = true
    const initialSelectionPos = tr.selection.from
    const splitDebugInfo = { nested: 0, remaining: 0, reason: 'unprocessed', index: itemIndex, splitAtStart }

    if (bulletListType) {
      const newItemResolved = tr.doc.resolve(Math.min(tr.doc.content.size, initialSelectionPos))
      let newListItem = null
      let newListItemPos = null
      if (listItemDepth <= newItemResolved.depth) {
        try {
          newListItem = newItemResolved.node(listItemDepth)
          newListItemPos = newItemResolved.before(listItemDepth)
        } catch (error) {
          splitDebugInfo.reason = `resolve-failed:${error?.message || 'unknown'}`
          newListItem = null
          newListItemPos = null
        }
      } else {
        splitDebugInfo.reason = `depth-mismatch:${listItemDepth}->${newItemResolved.depth}`
      }
      if (newListItem) {
        const nestedLists = []
        const remainingChildren = []
        newListItem.content.forEach((child) => {
          if (child.type === bulletListType) nestedLists.push(child)
          else remainingChildren.push(child)
        })
        splitDebugInfo.nested = nestedLists.length
        splitDebugInfo.remaining = remainingChildren.length
        splitDebugInfo.reason = nestedLists.length > 0 ? 'moved' : 'no-nested'

        if (nestedLists.length > 0) {
          const updatedNewItem = newListItem.type.create(newListItem.attrs, Fragment.fromArray(remainingChildren))
          tr.replaceWith(newListItemPos, newListItemPos + newListItem.nodeSize, updatedNewItem)

          const originalItemPos = tr.mapping.map(listItemPos, -1)
          const originalItem = tr.doc.nodeAt(originalItemPos)
          if (originalItem) {
            const originalChildren = []
            originalItem.content.forEach((child) => { originalChildren.push(child) })
            const updatedOriginal = originalItem.type.create(
              originalItem.attrs,
              Fragment.fromArray([...originalChildren, ...nestedLists])
            )
            tr.replaceWith(originalItemPos, originalItemPos + originalItem.nodeSize, updatedOriginal)
          } else {
            splitDebugInfo.reason = 'missing-original'
          }
        }
      } else if (!splitDebugInfo.reason.startsWith('resolve') && !splitDebugInfo.reason.startsWith('depth')) {
        splitDebugInfo.reason = 'no-new-item'
      }
    } else {
      splitDebugInfo.reason = 'no-bullet-type'
    }

    if (typeof window !== 'undefined') window.__WL_LAST_SPLIT = splitDebugInfo
    if (typeof console !== 'undefined') console.log('[split-debug] info', splitDebugInfo)

    const mappedSelectionPos = tr.mapping.map(initialSelectionPos, 1)
    const resolved = tr.doc.resolve(Math.min(tr.doc.content.size, mappedSelectionPos))
    const nextSelection = TextSelection.create(tr.doc, resolved.pos)
    view.dispatch(tr.setSelection(nextSelection).scrollIntoView())
  })

  if (!splitSuccess || !performed) return false
  view.focus()
  return true
}

const applySplitStatusAdjustments = (editor, meta) => {
  if (!editor || !meta) return null
  const { parentPos, originalIndex, newIndex, originalAttrs = {} } = meta
  const { state, view } = editor
  if (typeof console !== 'undefined') console.log('[split-adjust] invoked', meta)
  const parentNode = typeof parentPos === 'number' ? state.doc.nodeAt(parentPos) : null
  if (!parentNode) {
    if (typeof console !== 'undefined') console.log('[split-adjust] missing parent', { parentPos, originalIndex, newIndex })
    return null
  }

  const tr = state.tr
  let changed = false

  const newItemPos = positionOfListChild(parentNode, parentPos, newIndex)
  if (typeof newItemPos === 'number') {
    const newNode = tr.doc.nodeAt(newItemPos)
    if (newNode) {
      if (typeof console !== 'undefined') console.log('[split-adjust] new item', { parentPos, newIndex, attrs: newNode.attrs })
      const sanitizedAttrs = {
        ...newNode.attrs,
        status: STATUS_EMPTY,
        dataId: null,
        collapsed: false
      }
      if (
        sanitizedAttrs.status !== newNode.attrs.status ||
        sanitizedAttrs.dataId !== newNode.attrs.dataId ||
        sanitizedAttrs.collapsed !== newNode.attrs.collapsed
      ) {
        tr.setNodeMarkup(newItemPos, newNode.type, sanitizedAttrs, newNode.marks)
        changed = true
      }
    }
  }

  const originalItemPos = positionOfListChild(parentNode, parentPos, originalIndex)
  if (typeof originalItemPos === 'number') {
    const originalNode = tr.doc.nodeAt(originalItemPos)
    if (originalNode) {
      if (typeof console !== 'undefined') console.log('[split-adjust] original item', { parentPos, originalIndex, attrs: originalNode.attrs, restore: originalAttrs })
      const restoredAttrs = {
        ...originalNode.attrs,
        status: originalAttrs.status ?? STATUS_EMPTY,
        dataId: originalAttrs.dataId ?? null,
        collapsed: originalAttrs.collapsed ?? false
      }
      if (
        restoredAttrs.status !== originalNode.attrs.status ||
        restoredAttrs.dataId !== originalNode.attrs.dataId ||
        restoredAttrs.collapsed !== originalNode.attrs.collapsed
      ) {
        tr.setNodeMarkup(originalItemPos, originalNode.type, restoredAttrs, originalNode.marks)
        changed = true
      }
    }
  }

  if (changed) {
    view.dispatch(tr)
  }

  return { newItemPos, originalItemPos }
}


const promoteSplitSiblingToChild = (editor, context) => {
  if (!editor || !context) return false
  const { parentPos, originalIndex, newIndex, listItemType, bulletListType, paragraphType } = context
  const { state, view } = editor
  const parentNode = typeof parentPos === 'number' ? state.doc.nodeAt(parentPos) : null
  if (!parentNode || !listItemType || !bulletListType || !paragraphType) return false
  if (originalIndex < 0 || originalIndex >= parentNode.childCount) return false
  if (newIndex < 0 || newIndex >= parentNode.childCount) return false

  const originalNode = parentNode.child(originalIndex)
  const newSiblingNode = parentNode.child(newIndex)
  if (!originalNode || !newSiblingNode || newSiblingNode.type !== listItemType) return false

  let nestedListNode = null
  originalNode.content.forEach(child => { if (!nestedListNode && child.type === bulletListType) nestedListNode = child })
  if (!nestedListNode) return false

  const paragraphChild = newSiblingNode.child(0)
  const baseParagraph = paragraphChild && paragraphChild.type === paragraphType ? paragraphChild : paragraphType.create()
  const sanitizedChild = listItemType.create({
    ...newSiblingNode.attrs,
    status: STATUS_EMPTY,
    dataId: null,
    collapsed: false
  }, Fragment.from(baseParagraph))

  const updatedNestedChildren = []
  nestedListNode.content.forEach(child => { updatedNestedChildren.push(child) })
  updatedNestedChildren.push(sanitizedChild)
  const updatedNestedList = bulletListType.create(nestedListNode.attrs, Fragment.fromArray(updatedNestedChildren))

  const updatedOriginalChildren = []
  originalNode.content.forEach(child => {
    if (child === nestedListNode) updatedOriginalChildren.push(updatedNestedList)
    else updatedOriginalChildren.push(child)
  })
  const updatedOriginalNode = listItemType.create(originalNode.attrs, Fragment.fromArray(updatedOriginalChildren))

  const updatedParentChildren = []
  parentNode.content.forEach((child, index) => {
    if (index === originalIndex) updatedParentChildren.push(updatedOriginalNode)
    else if (index !== newIndex) updatedParentChildren.push(child)
  })
  const updatedParentNode = parentNode.type.create(parentNode.attrs, Fragment.fromArray(updatedParentChildren))

  let tr = state.tr.replaceWith(parentPos, parentPos + parentNode.nodeSize, updatedParentNode)

  let selectionPos = null
  const reloadedParent = tr.doc.nodeAt(parentPos)
  if (reloadedParent) {
    let runningPos = parentPos + 1
    for (let i = 0; i < reloadedParent.childCount; i += 1) {
      const child = reloadedParent.child(i)
      if (i === originalIndex) {
        let innerPos = runningPos + 1
        for (let j = 0; j < child.childCount; j += 1) {
          const inner = child.child(j)
          if (inner.type === paragraphType) {
            innerPos += inner.nodeSize
          } else if (inner.type === bulletListType) {
            let nestedPos = innerPos
            for (let k = 0; k < inner.childCount; k += 1) {
              const nestedItem = inner.child(k)
              if (k === inner.childCount - 1) {
                const nestedParagraph = nestedItem.child(0)
                if (nestedParagraph && nestedParagraph.type === paragraphType) {
                  const paragraphStart = nestedPos + 1
                  selectionPos = paragraphStart + nestedParagraph.content.size
                }
              }
              nestedPos += nestedItem.nodeSize
            }
            innerPos += inner.nodeSize
          } else {
            innerPos += inner.nodeSize
          }
        }
        break
      }
      runningPos += child.nodeSize
    }
  }

  if (selectionPos !== null) {
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos))
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[split-adjust] selection set failed', error)
    }
  }

  view.dispatch(tr.scrollIntoView())
  return true
}

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
  const reminderControlsEnabled = reminderActionsEnabledProp
  const ownBodyText = useMemo(() => gatherOwnListItemText(node), [node])
  const ownBodyTextAttr = useMemo(() => (ownBodyText || '').replace(/\s+/g, ' ').trim(), [ownBodyText])
  const reminder = useMemo(() => parseReminderTokenFromText(ownBodyText), [ownBodyText])
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
  const [isActive, setIsActive] = useState(false)
  const reminderAreaRef = useRef(null)
  const [reminderOffset, setReminderOffset] = useState(null)
  const [reminderInlineGap, setReminderInlineGap] = useState(0)
  const [reminderTop, setReminderTop] = useState(0)

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
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'schedule', taskId: String(realId), remindAt }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled])

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
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'schedule', taskId: String(realId), remindAt }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, customDate, ensurePersistentTaskId, reminderControlsEnabled])

  const handleDismissReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    try {
      const realId = await ensurePersistentTaskId()
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'dismiss', taskId: String(realId) }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to dismiss reminder')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled])

  const handleCompleteReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    try {
      const realId = await ensurePersistentTaskId()
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'complete', taskId: String(realId) }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to mark complete')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled])

  const handleRemoveReminder = useCallback(async () => {
    if (!reminderControlsEnabled) return
    try {
      const realId = await ensurePersistentTaskId()
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'remove', taskId: String(realId) }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Unable to remove reminder')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled])

  const handleStatusKeyDown = useCallback((event) => {
    if (event.key !== 'Enter') return
    if (readOnly && !allowStatusToggleInReadOnly) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (typeof pos !== 'number' || !editor) return
      const { state, view } = editor
      const resolved = state.doc.resolve(pos)
      const listItemDepth = findListItemDepth(resolved)
      if (listItemDepth === -1) return
      const listItemPos = resolved.before(listItemDepth)
      const listItemNode = state.doc.nodeAt(listItemPos)
      if (!listItemNode || listItemNode.type.name !== 'listItem' || listItemNode.childCount === 0) return
      const paragraphNode = listItemNode.child(0)
      if (!paragraphNode || paragraphNode.type.name !== 'paragraph') return
      const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
      const parentPos = parentDepth !== null ? resolved.before(parentDepth) : null
      const originalIndex = resolved.index(listItemDepth)
      const originalAttrs = { ...(listItemNode.attrs || {}) }
      editor.commands.focus()
      const paragraphStart = pos + 1
      const paragraphEnd = paragraphStart + paragraphNode.nodeSize - 1
      const tr = state.tr.setSelection(TextSelection.create(state.doc, paragraphEnd))
      view.dispatch(tr)
      const didSplit = runSplitListItemWithSelection(editor, { splitAtStart: false })
      if (didSplit) {
        applySplitStatusAdjustments(editor, {
          parentPos,
          originalIndex,
          newIndex: originalIndex + 1,
          originalAttrs
        })
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

  const reminderDismissed = reminder?.status === 'dismissed'
  const reminderCompleted = reminder?.status === 'completed'
  const activeReminder = reminder?.status === 'incomplete'
  const reminderDue = reminderIsDue(reminder)
  const reminderDisplay = useMemo(() => computeReminderDisplay(reminder), [reminder])
  const reminderSummary = reminderDisplay.summary
  const reminderButtonLabel = reminderSummary
    ? `Reminder options (${reminderSummary})`
    : 'Reminder options'


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
  }, [reminderControlsEnabled, reminderMenuOpen, activeReminder, collapsed])

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
  const [debugLines, setDebugLines] = useState([])
  const slashHandlersRef = useRef({ handleKeyDown: () => false, openAt: () => {} })
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
  const focusShortcutActiveRef = useRef(false)
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
  const draggingRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const convertingImagesRef = useRef(false)
  const suppressSelectionRestoreRef = useRef(false)
  const pendingEmptyCaretRef = useRef(false)

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

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])
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
            markDirty()
            if (saveTimer.current) clearTimeout(saveTimer.current)
            void doSave()
            pushDebug('paste: outline doc restored (legacy)')
            return true
          }
          if (result.payload.kind === 'slice') {
            const slice = result.payload.slice
            const tr = state.tr.replaceSelection(slice).scrollIntoView()
            view.dispatch(tr)
            view.focus()
            markDirty()
            if (saveTimer.current) clearTimeout(saveTimer.current)
            void doSave()
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
        if (isReadOnly) return false
        const handledBySlash = slashHandlersRef.current.handleKeyDown(view, event)
        if (handledBySlash) return true
        if (event.key === 'Escape') {
          if (focusRootRef.current) {
            event.preventDefault()
            event.stopPropagation()
            pendingFocusScrollRef.current = null
            setFocusRootId(null)
            return true
          }
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
              remindAt: info?.remindAt,
              dates: info?.dates
            })
          }
          return true
        }
        if (event.key === 'Enter') {
          const enterStartedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
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

          const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
          const parentPos = parentDepth !== null ? $from.before(parentDepth) : null
          const originalAttrs = { ...(listItemNode.attrs || {}) }

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
            const paragraphStart = pos + 1
            const paragraphEnd = paragraphStart + para.content.size
            return tr.setSelection(TextSelection.create(tr.doc, paragraphEnd))
          }

          const onlyParagraph = listItemNode.childCount === 1 && listItemNode.child(0)?.type?.name === 'paragraph'
          const paragraphEmpty = paragraphNode.content.size === 0

          let nestedListInfo = null
          if (bulletListType) {
            let childPos = listItemPos + 1
            listItemNode.content.forEach((child) => {
              if (!nestedListInfo && child.type === bulletListType) {
                nestedListInfo = { node: child, pos: childPos }
              }
              childPos += child.nodeSize
            })
          }

          if (onlyParagraph && paragraphEmpty && isAtStart && isAtEnd) {
            const newSibling = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
            const insertPos = listItemPos + listItemNode.nodeSize
            let tr = state.tr.insert(insertPos, newSibling)
            const selectionTarget = (() => {
              const inserted = tr.doc.nodeAt(insertPos)
              if (!inserted || inserted.childCount === 0) return null
              const para = inserted.child(0)
              const paragraphStart = insertPos + 1
              return paragraphStart + para.content.size
            })()
            tr = placeCursorAtEnd(tr, insertPos)
            view.dispatch(tr.scrollIntoView())
            if (selectionTarget !== null) {
              const mappedPos = tr.mapping.map(selectionTarget, 1)
                try {
                const latest = view.state
                const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
                const resolved = latest.doc.resolve(clamped)
                const targetSelection = TextSelection.near(resolved, -1)
                view.dispatch(latest.tr.setSelection(targetSelection))
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('[split-adjust] empty sibling selection restore failed', error)
              }
            }
            view.focus()
            requestAnimationFrame(() => view.focus())
            logCursorTiming('empty-sibling', enterStartedAt)
            return true
          }

          if (!isChild && isAtEnd && nestedListInfo) {
            const isCollapsed = !!listItemNode.attrs?.collapsed
            if (isCollapsed) {
              const newSibling = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
              const insertPos = listItemPos + listItemNode.nodeSize
              let tr = state.tr.insert(insertPos, newSibling)
              const selectionTarget = (() => {
                const inserted = tr.doc.nodeAt(insertPos)
                if (!inserted || inserted.childCount === 0) return null
                const para = inserted.child(0)
                const paragraphStart = insertPos + 1
                return paragraphStart + para.content.size
              })()
              tr = placeCursorAtEnd(tr, insertPos)
              view.dispatch(tr.scrollIntoView())
              if (selectionTarget !== null) {
                const mappedPos = tr.mapping.map(selectionTarget, 1)
                try {
                  const latest = view.state
                  const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
                  const resolved = latest.doc.resolve(clamped)
                  const targetSelection = TextSelection.near(resolved, -1)
                  view.dispatch(latest.tr.setSelection(targetSelection))
                } catch (error) {
                  if (typeof console !== 'undefined') console.warn('[split-adjust] collapsed sibling selection restore failed', error)
                }
              }
              view.focus()
              requestAnimationFrame(() => view.focus())
              logCursorTiming('split-parent-keep-children', enterStartedAt)
              return true
            }

            const { node: nestedListNode, pos: nestedListPos } = nestedListInfo
            const newChild = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
            const childInsertPos = nestedListPos + nestedListNode.nodeSize - 1
            let tr = state.tr.insert(childInsertPos, newChild)
            const selectionTarget = (() => {
              const inserted = tr.doc.nodeAt(childInsertPos)
              if (!inserted || inserted.childCount === 0) return null
              const para = inserted.child(0)
              const paragraphStart = childInsertPos + 1
              return paragraphStart + para.content.size
            })()
            tr = placeCursorAtEnd(tr, childInsertPos)
            view.dispatch(tr.scrollIntoView())
            if (selectionTarget !== null) {
              const mappedPos = tr.mapping.map(selectionTarget, 1)
              try {
                const latest = view.state
                const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
                const resolved = latest.doc.resolve(clamped)
                const targetSelection = TextSelection.near(resolved, -1)
                view.dispatch(latest.tr.setSelection(targetSelection))
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('[split-adjust] selection restore failed', error)
              }
            }
            view.focus()
            requestAnimationFrame(() => view.focus())
            logCursorTiming('append-child-from-parent', enterStartedAt)
            return true
          }

          if (isChild && isAtStart) {
            const newSiblingNode = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
            let tr = state.tr.insert(listItemPos, newSiblingNode)
            const selectionTarget = (() => {
              const inserted = tr.doc.nodeAt(listItemPos)
              if (!inserted || inserted.childCount === 0) return null
              const para = inserted.child(0)
              const paragraphStart = listItemPos + 1
              return paragraphStart + para.content.size
            })()
            tr = placeCursorAtEnd(tr, listItemPos)
            view.dispatch(tr)
            if (selectionTarget !== null) {
              const mappedPos = tr.mapping.map(selectionTarget, 1)
              try {
                const latest = view.state
                const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
                const resolved = latest.doc.resolve(clamped)
                const targetSelection = TextSelection.near(resolved, -1)
                view.dispatch(latest.tr.setSelection(targetSelection))
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('[split-adjust] prepend selection restore failed', error)
              }
            }
            view.focus()
            requestAnimationFrame(() => view.focus())
            logCursorTiming('prepend-child', enterStartedAt)
            return true
          }

          const paragraphEndPos = listItemPos + 1 + paragraphNode.nodeSize - 1
          if (offset !== paragraphNode.content.size) {
            const endSelection = TextSelection.create(view.state.doc, paragraphEndPos)
            view.dispatch(view.state.tr.setSelection(endSelection))
          }
          const originalIndex = $from.index(listItemDepth)
          const splitMeta = {
            parentPos,
            originalIndex,
            newIndex: originalIndex + 1,
            originalAttrs
          }
          const didSplit = runSplitListItemWithSelection(editor, { splitAtStart: false })
          if (typeof console !== 'undefined') console.log('[split-debug] didSplit', didSplit)
          if (didSplit) {
            if (typeof console !== 'undefined') console.log('[split-debug] applying adjustments', splitMeta)
            const adjustment = applySplitStatusAdjustments(editor, splitMeta)
            const promoted = !isChild && isAtEnd && !!nestedListInfo && promoteSplitSiblingToChild(editor, {
              parentPos,
              originalIndex,
              newIndex: splitMeta.newIndex,
              listItemType,
              bulletListType,
              paragraphType
            })
            if (promoted) {
              view.focus()
              requestAnimationFrame(() => view.focus())
              logCursorTiming('append-child-from-parent', enterStartedAt)
              return true
            }
            let selectionAdjusted = false
            let finalCaretPos = null
            if (isChild && typeof parentPos === 'number') {
              try {
                const latest = view.state
                const parentLatest = latest.doc.nodeAt(parentPos)
                let targetPos = typeof adjustment?.newItemPos === 'number' ? adjustment.newItemPos : null
                if (targetPos === null && parentLatest) {
                  const originalEnd = listItemPos + listItemNode.nodeSize
                  let cursor = parentPos + 1
                  for (let idx = 0; idx < parentLatest.childCount; idx += 1) {
                    const child = parentLatest.child(idx)
                    const paraChild = child?.childCount ? child.child(0) : null
                    const isEmpty = paraChild?.type?.name === 'paragraph' && paraChild.content.size === 0
                    if (isEmpty && cursor >= originalEnd) {
                      targetPos = cursor
                      break
                    }
                    cursor += child.nodeSize
                  }
                  if (targetPos === null) {
                    cursor = parentPos + 1
                    for (let idx = 0; idx < parentLatest.childCount; idx += 1) {
                      const child = parentLatest.child(idx)
                      const paraChild = child?.childCount ? child.child(0) : null
                      const isEmpty = paraChild?.type?.name === 'paragraph' && paraChild.content.size === 0
                      if (isEmpty) {
                        targetPos = cursor
                        break
                      }
                      cursor += child.nodeSize
                    }
                  }
                }
                let resolvedPos = typeof targetPos === 'number' ? targetPos : null
                let resolvedNode = typeof targetPos === 'number' ? latest.doc.nodeAt(targetPos) : null
                if (resolvedNode && parentLatest) {
                  const para = resolvedNode.childCount > 0 ? resolvedNode.child(0) : null
                  const isEmpty = para?.type?.name === 'paragraph' && para.content.size === 0
                  if (!isEmpty) {
                    const scanStart = listItemPos + listItemNode.nodeSize
                    let cursor = parentPos + 1
                    for (let idx = 0; idx < parentLatest.childCount; idx += 1) {
                      const child = parentLatest.child(idx)
                      const paraChild = child?.childCount ? child.child(0) : null
                      const childEmpty = paraChild?.type?.name === 'paragraph' && paraChild.content.size === 0
                      if (childEmpty && cursor >= scanStart) {
                        resolvedPos = cursor
                        resolvedNode = latest.doc.nodeAt(cursor)
                        break
                      }
                      cursor += child.nodeSize
                    }
                  }
                }
                if (resolvedNode && resolvedNode.childCount > 0) {
                  const para = resolvedNode.child(0)
                  const paragraphStart = (resolvedPos ?? 0) + 1
                  const caretPos = para ? paragraphStart + para.content.size : (resolvedPos ?? 0) + resolvedNode.nodeSize - 1
                  selectionAdjusted = true
                  finalCaretPos = caretPos
                  suppressSelectionRestoreRef.current = true
                  pendingEmptyCaretRef.current = true
                }
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('[split-adjust] child caret restore failed', error)
              }
            }
            view.focus()
            requestAnimationFrame(() => view.focus())
            if (selectionAdjusted) {
              const applyCaretSelection = () => {
                try {
                  const refreshed = view.state
                  const clamped = Math.max(0, Math.min(finalCaretPos ?? 0, refreshed.doc.content.size))
                  const chainResult = editor?.chain?.().focus().setTextSelection({ from: clamped, to: clamped }).run()
                  if (!chainResult) {
                    const tr = refreshed.tr.setSelection(TextSelection.create(refreshed.doc, clamped)).scrollIntoView()
                    view.dispatch(tr)
                  }
                } catch (error) {
                  if (typeof console !== 'undefined') console.warn('[split-adjust] caret apply failed', error)
                }
              }
              applyCaretSelection()
              if (typeof window !== 'undefined') {
                window.requestAnimationFrame(applyCaretSelection)
                window.setTimeout(applyCaretSelection, 0)
              }
            }
            logCursorTiming('split-list-item', enterStartedAt)
            return true
          }
          return false
        }
        if (event.key === 'Tab') {
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (!inCode) {
            event.preventDefault()
            const direction = event.shiftKey ? 'lift' : 'sink'
            const focusEmpty = () => {
              if (!pendingEmptyCaretRef.current) return
              pendingEmptyCaretRef.current = false
              try {
                const { state: curState, view: curView } = editor
                let targetPos = null
                curState.doc.descendants((node, pos) => {
                  if (node.type.name === 'listItem') {
                    const para = node.child(0)
                    const empty = para && para.type.name === 'paragraph' && para.content.size === 0
                    if (empty) targetPos = pos
                  }
                })
                if (targetPos != null) {
                  const caretPos = targetPos + 1
                  const chainResult = editor.chain().focus().setTextSelection({ from: caretPos, to: caretPos }).run()
                  if (!chainResult) {
                    const tr = curState.tr.setSelection(TextSelection.create(curState.doc, caretPos)).scrollIntoView()
                    curView.dispatch(tr)
                  }
                }
              } catch (error) {
                if (typeof console !== 'undefined') console.warn('[split-adjust] focus empty failed', error)
              }
            }
            const handled = runListIndentCommand(editor, direction, focusEmpty)
            if (handled) {
              pushDebug('indentation', { shift: event.shiftKey })
              return true
            }
            pushDebug('indentation-failed', { shift: event.shiftKey })
            return false
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
          slashHandlersRef.current.openAt({ x: rect.left, y: rect.bottom + 4 })
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
    const shouldRestoreSelection = !suppressSelectionRestoreRef.current
    if (!query) {
      tr.setMeta('addToHistory', false)
      if (shouldRestoreSelection) {
        tr.setSelection(selection.map(tr.doc, tr.mapping))
      } else {
        suppressSelectionRestoreRef.current = false
      }
      editor.view.dispatch(tr)
      return
    }
    let regex
    try {
      regex = new RegExp(escapeForRegex(query), 'gi')
    } catch {
      tr.setMeta('addToHistory', false)
      if (shouldRestoreSelection) {
        tr.setSelection(selection.map(tr.doc, tr.mapping))
      } else {
        suppressSelectionRestoreRef.current = false
      }
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
    if (shouldRestoreSelection) {
      tr.setSelection(selection.map(tr.doc, tr.mapping))
    } else {
      suppressSelectionRestoreRef.current = false
    }
    editor.view.dispatch(tr)
  }, [editor])

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
      const runId = filterRunCounterRef.current = filterRunCounterRef.current + 1
      const start = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()
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
        const reminder = parseReminderTokenFromText(node.textContent || '')
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
          remindAt: reminder?.remindAt || null
        }
      }
    } catch {
      return null
    }
    return null
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
      scheduleApplyStatusFilter('focusTaskById')
      return true
    } catch (err) {
      console.error('[outline] failed to focus task', err)
      return false
    }
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
      emitOutlineSnapshot(outline)
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
    emitOutlineSnapshot(roots)
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
    const cleaned = text
      .replace(REMINDER_TOKEN_REGEX, '')
      .replace(DATE_RE, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return cleaned || 'Untitled'
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
