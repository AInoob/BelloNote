// ============================================================================
// Enter Key Handler
// Handles Enter key press logic for list items in the editor
// ============================================================================

import { TextSelection } from 'prosemirror-state'
import { Fragment } from 'prosemirror-model'

const STATUS_EMPTY = ''

/**
 * Places cursor at the end of a newly created node
 * @param {Transaction} tr - ProseMirror transaction
 * @param {number} pos - Position of the node
 * @returns {Transaction} Modified transaction
 */
function placeCursorAtEnd(tr, pos) {
  const insertedNode = tr.doc.nodeAt(pos)
  if (!insertedNode || insertedNode.childCount === 0) return tr
  const para = insertedNode.child(0)
  const paragraphStart = pos + 1
  const paragraphEnd = paragraphStart + para.content.size
  return tr.setSelection(TextSelection.create(tr.doc, paragraphEnd))
}

/**
 * Finds the depth of the listItem containing the current selection
 * @param {ResolvedPos} $from - Resolved position from selection
 * @returns {number} Depth of listItem or -1 if not found
 */
function findListItemDepth($from) {
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth)?.type?.name === 'listItem') return depth
  }
  return -1
}

/**
 * Finds nested bulletList info within a listItem
 * @param {Node} listItemNode - List item node
 * @param {number} listItemPos - Position of list item
 * @param {NodeType} bulletListType - BulletList node type
 * @returns {Object|null} Object with {node, pos} or null
 */
function findNestedListInfo(listItemNode, listItemPos, bulletListType) {
  if (!bulletListType) return null
  let nestedListInfo = null
  let childPos = listItemPos + 1
  listItemNode.content.forEach((child) => {
    if (!nestedListInfo && child.type === bulletListType) {
      nestedListInfo = { node: child, pos: childPos }
    }
    childPos += child.nodeSize
  })
  return nestedListInfo
}

/**
 * Attempts to restore selection after split operation
 * @param {EditorView} view - ProseMirror view
 * @param {Transaction} tr - Transaction
 * @param {number|null} selectionTarget - Target position
 */
function restoreSelectionAfterSplit(view, tr, selectionTarget) {
  if (selectionTarget === null) return
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

/**
 * Gets selection target position for a newly inserted node
 * @param {Transaction} tr - Transaction
 * @param {number} insertPos - Position where node was inserted
 * @returns {number|null} Target position or null
 */
function getSelectionTarget(tr, insertPos) {
  const inserted = tr.doc.nodeAt(insertPos)
  if (!inserted || inserted.childCount === 0) return null
  const para = inserted.child(0)
  const paragraphStart = insertPos + 1
  return paragraphStart + para.content.size
}

/**
 * Handles Enter key press in list items
 * @param {Object} params - Parameters
 * @param {Event} params.event - Keyboard event
 * @param {Editor} params.editor - TipTap editor
 * @param {Function} params.pushDebug - Debug logging function
 * @param {Function} params.logCursorTiming - Cursor timing logger
 * @param {Function} params.runSplitListItemWithSelection - Split list item function
 * @param {Function} params.applySplitStatusAdjustments - Apply status adjustments
 * @param {Function} params.promoteSplitSiblingToChild - Promote sibling to child
 * @param {Object} params.suppressSelectionRestoreRef - Ref for suppressing selection restore
 * @param {Object} params.pendingEmptyCaretRef - Ref for pending empty caret
 * @returns {boolean} True if handled
 */
export function handleEnterKey({
  event,
  editor,
  pushDebug,
  logCursorTiming,
  runSplitListItemWithSelection,
  applySplitStatusAdjustments,
  promoteSplitSiblingToChild,
  suppressSelectionRestoreRef,
  pendingEmptyCaretRef
}) {
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

  const listItemDepth = findListItemDepth($from)
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

  const onlyParagraph = listItemNode.childCount === 1 && listItemNode.child(0)?.type?.name === 'paragraph'
  const paragraphEmpty = paragraphNode.content.size === 0

  const nestedListInfo = findNestedListInfo(listItemNode, listItemPos, bulletListType)

  // Case 1: Empty paragraph - create new sibling
  if (onlyParagraph && paragraphEmpty && isAtStart && isAtEnd) {
    const newSibling = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
    const insertPos = listItemPos + listItemNode.nodeSize
    let tr = state.tr.insert(insertPos, newSibling)
    const selectionTarget = getSelectionTarget(tr, insertPos)
    tr = placeCursorAtEnd(tr, insertPos)
    view.dispatch(tr.scrollIntoView())
    restoreSelectionAfterSplit(view, tr, selectionTarget)
    view.focus()
    requestAnimationFrame(() => view.focus())
    logCursorTiming('empty-sibling', enterStartedAt)
    return true
  }

  // Case 2: At end with children - handle collapsed/expanded
  if (!isChild && isAtEnd && nestedListInfo) {
    const isCollapsed = !!listItemNode.attrs?.collapsed
    if (isCollapsed) {
      const newSibling = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
      const insertPos = listItemPos + listItemNode.nodeSize
      let tr = state.tr.insert(insertPos, newSibling)
      const selectionTarget = getSelectionTarget(tr, insertPos)
      tr = placeCursorAtEnd(tr, insertPos)
      view.dispatch(tr.scrollIntoView())
      restoreSelectionAfterSplit(view, tr, selectionTarget)
      view.focus()
      requestAnimationFrame(() => view.focus())
      logCursorTiming('split-parent-keep-children', enterStartedAt)
      return true
    }

    const { node: nestedListNode, pos: nestedListPos } = nestedListInfo
    const newChild = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
    const childInsertPos = nestedListPos + nestedListNode.nodeSize - 1
    let tr = state.tr.insert(childInsertPos, newChild)
    const selectionTarget = getSelectionTarget(tr, childInsertPos)
    tr = placeCursorAtEnd(tr, childInsertPos)
    view.dispatch(tr.scrollIntoView())
    restoreSelectionAfterSplit(view, tr, selectionTarget)
    view.focus()
    requestAnimationFrame(() => view.focus())
    logCursorTiming('append-child-from-parent', enterStartedAt)
    return true
  }

  // Case 3: At start of child item - create new sibling before
  if (isChild && isAtStart) {
    const newSiblingNode = listItemType.create(defaultAttrs, Fragment.from(paragraphType.create()))
    let tr = state.tr.insert(listItemPos, newSiblingNode)
    const selectionTarget = getSelectionTarget(tr, listItemPos)
    tr = placeCursorAtEnd(tr, listItemPos)
    view.dispatch(tr)
    restoreSelectionAfterSplit(view, tr, selectionTarget)
    view.focus()
    requestAnimationFrame(() => view.focus())
    logCursorTiming('prepend-child', enterStartedAt)
    return true
  }

  // Case 4: Default split behavior
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
