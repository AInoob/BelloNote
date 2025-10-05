import { TextSelection } from 'prosemirror-state'
import { STATUS_EMPTY } from './constants.js'
import {
  applySplitStatusAdjustments,
  runSplitListItemWithSelection,
  promoteSplitSiblingToChild,
  positionOfListChild
} from './listCommands.js'

const noop = () => {}

function defaultNow() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now()
}

function coerceEnterArgs(args) {
  const fallbackPendingRef = { current: false }
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && 'event' in args[0]) {
    const { event, editor, now, logCursorTiming, pushDebug, pendingEmptyCaretRef } = args[0]
    return {
      event,
      editor,
      now: typeof now === 'function' ? now : defaultNow,
      logCursorTiming: logCursorTiming || noop,
      pushDebug: pushDebug || noop,
      pendingEmptyCaretRef: pendingEmptyCaretRef || fallbackPendingRef
    }
  }
  const [event, editor, now, logCursorTiming, pushDebug, pendingEmptyCaretRef] = args
  return {
    event,
    editor,
    now: typeof now === 'function' ? now : defaultNow,
    logCursorTiming: logCursorTiming || noop,
    pushDebug: pushDebug || noop,
    pendingEmptyCaretRef: pendingEmptyCaretRef || fallbackPendingRef
  }
}

function isEffectivelyEmptyListItem(listItemNode) {
  if (!listItemNode || listItemNode.type?.name !== 'listItem') return false
  if (listItemNode.childCount === 0) return true
  let sawParagraph = false
  for (let index = 0; index < listItemNode.childCount; index += 1) {
    const child = listItemNode.child(index)
    if (child.type?.name !== 'paragraph') return false
    sawParagraph = true
    if (child.content.size > 0) return false
  }
  return sawParagraph
}

function ensureSelection(view, editor, caretPos) {
  if (caretPos == null) return
  const latest = view.state
  const clamped = Math.max(0, Math.min(caretPos, latest.doc.content.size))
  const chainResult = editor?.chain?.().focus().setTextSelection({ from: clamped, to: clamped }).run()
  if (!chainResult) {
    const tr = latest.tr.setSelection(TextSelection.create(latest.doc, clamped)).scrollIntoView()
    view.dispatch(tr)
  }
}

/**
 * Handle Enter key press in the editor
 * @returns {boolean} True if handled, false otherwise
 */
export function handleEnterKey(...rawArgs) {
  const { event, editor, now, logCursorTiming, pushDebug, pendingEmptyCaretRef } = coerceEnterArgs(rawArgs)
  if (!event || !editor) return false
  const { state, view } = editor
  if (!state || !view) return false

  const { $from } = view.state.selection
  if (!$from) return false
  if ($from.parent?.type?.name === 'codeBlock') return false

  const schema = editor.schema
  const listItemType = schema?.nodes?.listItem
  const paragraphType = schema?.nodes?.paragraph
  const bulletListType = schema?.nodes?.bulletList
  if (!listItemType || !paragraphType) return false

  event.preventDefault?.()
  event.stopPropagation?.()

  const enterStartedAt = now()

  let listItemDepth = -1
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth)?.type?.name === 'listItem') {
      listItemDepth = depth
      break
    }
  }
  if (listItemDepth === -1) return false

  const listItemPos = $from.before(listItemDepth)
  const listItemNode = $from.node(listItemDepth)
  if (!listItemNode || listItemNode.type.name !== 'listItem') return false

  const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
  const parentPos = parentDepth !== null ? $from.before(parentDepth) : null
  const listParent = parentDepth !== null ? $from.node(parentDepth) : null
  let originalIndex = $from.index(listItemDepth)
  if (listParent && typeof parentPos === 'number') {
    let probePos = parentPos + 1
    for (let idx = 0; idx < listParent.childCount; idx += 1) {
      if (probePos === listItemPos) {
        originalIndex = idx
        break
      }
      const childNode = listParent.child(idx)
      probePos += childNode?.nodeSize ?? 0
    }
  }

  const defaultAttrs = {
    dataId: null,
    status: STATUS_EMPTY,
    collapsed: false,
    archivedSelf: false,
    tags: []
  }

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

  const emptyListItem = isEffectivelyEmptyListItem(listItemNode)

  if (emptyListItem) {
    const insertPos = listItemPos + listItemNode.nodeSize
    const newSibling = listItemType.create(defaultAttrs, paragraphType.create())
    const tr = state.tr.insert(insertPos, newSibling)
    view.dispatch(tr.scrollIntoView())

    const newIndex = originalIndex + 1
    let caretPos = insertPos + 1
    try {
      if (typeof parentPos === 'number') {
        const latest = view.state
        const parentLatest = latest.doc.nodeAt(parentPos)
        if (parentLatest) {
          const newItemPos = positionOfListChild(parentLatest, parentPos, newIndex)
          if (typeof newItemPos === 'number') {
            const newNode = latest.doc.nodeAt(newItemPos)
            if (newNode) {
              const para = newNode.childCount > 0 ? newNode.child(0) : null
              caretPos = para ? newItemPos + 1 + para.content.size : newItemPos + Math.max(1, newNode.nodeSize - 1)
            }
          }
        }
      }
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[enter-empty] caret resolve failed', error)
    }

    if (pendingEmptyCaretRef && typeof pendingEmptyCaretRef === 'object') {
      pendingEmptyCaretRef.current = { type: 'caret', pos: caretPos }
    }

    const applyCaretSelection = () => {
      try {
        const refreshed = view.state
        const clamped = Math.max(0, Math.min(caretPos, refreshed.doc.content.size))
        const targetSelection = TextSelection.create(refreshed.doc, clamped)
        view.dispatch(refreshed.tr.setSelection(targetSelection).scrollIntoView())
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[enter-empty] caret apply failed', error)
      }
    }

    applyCaretSelection()
    view.focus()
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        applyCaretSelection()
        view.focus()
      })
      window.setTimeout(() => {
        applyCaretSelection()
        view.focus()
      }, 0)
    }
    logCursorTiming('empty-sibling', enterStartedAt)
    return true
  }

  const paragraphNode = listItemNode.child(0)
  if (!paragraphNode || paragraphNode.type.name !== 'paragraph') return false

  const inParagraph = $from.parent === paragraphNode
  const offset = inParagraph ? $from.parentOffset : 0
  const isAtStart = inParagraph && offset === 0
  const isAtEnd = inParagraph && offset === paragraphNode.content.size
  const isChild = listItemDepth > 2

  pushDebug('enter: state', { isChild, isAtStart, isAtEnd, offset, paraSize: paragraphNode.content.size, collapsed: !!listItemNode.attrs?.collapsed })

  if (!isChild && isAtEnd && nestedListInfo) {
    const isCollapsed = !!listItemNode.attrs?.collapsed
    if (isCollapsed) {
      const insertPos = listItemPos + listItemNode.nodeSize
      const newSibling = listItemType.create(defaultAttrs, paragraphType.create())
      const tr = state.tr.insert(insertPos, newSibling)
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView()
      view.dispatch(tr)
      view.focus()
      requestAnimationFrame(() => view.focus())
      logCursorTiming('split-parent-keep-children', enterStartedAt)
      return true
    }

    const { node: nestedListNode, pos: nestedListPos } = nestedListInfo
    const childInsertPos = nestedListPos + nestedListNode.nodeSize - 1
    const newChild = listItemType.create(defaultAttrs, paragraphType.create())
    const tr = state.tr.insert(childInsertPos, newChild)
    tr.setSelection(TextSelection.create(tr.doc, childInsertPos + 1)).scrollIntoView()
    view.dispatch(tr)
    view.focus()
    requestAnimationFrame(() => view.focus())
    logCursorTiming('append-child-from-parent', enterStartedAt)
    return true
  }

  if (isChild && isAtStart) {
    const tr = state.tr.insert(listItemPos, listItemType.create(defaultAttrs, paragraphType.create()))
    tr.setSelection(TextSelection.create(tr.doc, listItemPos + 1)).scrollIntoView()
    view.dispatch(tr)
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

  const splitMeta = {
    parentPos,
    originalIndex,
    newIndex: originalIndex + 1,
    originalAttrs: { ...(listItemNode.attrs || {}) }
  }
  const didSplit = runSplitListItemWithSelection(editor, { splitAtStart: false })
  if (!didSplit) return false

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

  const latest = view.state
  const parentLatest = typeof parentPos === 'number' ? latest.doc.nodeAt(parentPos) : null
  let targetPos = typeof adjustment?.newItemPos === 'number' ? adjustment.newItemPos : null
  if (targetPos == null && parentLatest) {
    targetPos = positionOfListChild(parentLatest, parentPos, splitMeta.newIndex)
  }

  if (targetPos == null && parentLatest) {
    let cursor = parentPos + 1
    for (let idx = 0; idx < parentLatest.childCount; idx += 1) {
      const child = parentLatest.child(idx)
      const paraChild = child?.childCount ? child.child(0) : null
      const isEmpty = paraChild?.type?.name === 'paragraph' && paraChild.content.size === 0
      if (isEmpty && idx >= splitMeta.newIndex) {
        targetPos = cursor
        break
      }
      cursor += child.nodeSize
    }
  }

  if (typeof targetPos === 'number') {
    const newNode = latest.doc.nodeAt(targetPos)
    if (newNode) {
      const para = newNode.childCount > 0 ? newNode.child(0) : null
      const caretPos = para ? targetPos + 1 + para.content.size : targetPos + Math.max(1, newNode.nodeSize - 1)
      pendingEmptyCaretRef.current = true
      ensureSelection(view, editor, caretPos)
      view.focus()
      requestAnimationFrame(() => view.focus())
      logCursorTiming('split-list-item', enterStartedAt)
      return true
    }
  }

  view.focus()
  requestAnimationFrame(() => view.focus())
  logCursorTiming('split-list-item', enterStartedAt)
  return true
}
