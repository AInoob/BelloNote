import { TextSelection } from 'prosemirror-state'
import { Fragment } from 'prosemirror-model'
import { STATUS_EMPTY } from './constants.js'
import {
  applySplitStatusAdjustments,
  runSplitListItemWithSelection,
  promoteSplitSiblingToChild,
  positionOfListChild
} from './listCommands.js'

/**
 * Handle Enter key press in the editor
 * @param {Event} event - Keyboard event
 * @param {Object} editor - TipTap editor instance
 * @param {Function} now - Function to get current timestamp
 * @param {Function} logCursorTiming - Function to log cursor timing
 * @param {Function} pushDebug - Function to push debug message
 * @param {Object} pendingEmptyCaretRef - Ref to pending empty caret state
 * @returns {boolean} True if handled, false otherwise
 */
export function handleEnterKey(event, editor, now, logCursorTiming, pushDebug, pendingEmptyCaretRef) {
  const enterStartedAt = now()
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
  const listParent = parentDepth !== null ? $from.node(parentDepth) : null
  const originalAttrs = { ...(listItemNode.attrs || {}) }
  let originalIndex = $from.index(listItemDepth)
  if (listParent) {
    for (let idx = 0; idx < listParent.childCount; idx += 1) {
      if (listParent.child(idx) === listItemNode) {
        originalIndex = idx
        break
      }
    }
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
  if (typeof window !== 'undefined') {
    window.__ENTER_DEBUG = {
      listItemDepth,
      parentPos,
      originalIndex,
      newIndex: originalIndex + 1,
      isChild,
      isAtStart,
      isAtEnd
    }
  }
  pushDebug('enter: state', { isChild, isAtStart, isAtEnd, offset, paraSize: paragraphNode.content.size, collapsed: !!listItemNode.attrs?.collapsed })

  const defaultAttrs = {
    dataId: null,
    status: STATUS_EMPTY,
    collapsed: false,
    archivedSelf: false,
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
    if (!selectionAdjusted && typeof parentPos === 'number') {
      try {
        const latest = view.state
        const parentNode = latest.doc.nodeAt(parentPos)
        const newItemPos = parentNode ? positionOfListChild(parentNode, parentPos, splitMeta.newIndex) : null
        if (typeof newItemPos === 'number') {
          const newNode = latest.doc.nodeAt(newItemPos)
          if (newNode) {
            const para = newNode.childCount > 0 ? newNode.child(0) : null
            const caretPos = para ? newItemPos + 1 + para.content.size : newItemPos + newNode.nodeSize - 1
            if (typeof console !== 'undefined') console.log('[split-adjust] top-level caret', { newItemPos, caretPos, newIndex: splitMeta.newIndex })
            const chainResult = editor?.chain?.().focus().setTextSelection({ from: caretPos, to: caretPos }).run()
            if (!chainResult) {
              const tr = latest.tr.setSelection(TextSelection.create(latest.doc, caretPos)).scrollIntoView()
              view.dispatch(tr)
            }
            finalCaretPos = caretPos
            selectionAdjusted = true
            pendingEmptyCaretRef.current = true
          }
        }
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[split-adjust] top-level caret resolve failed', error)
      }
    }
    if (!selectionAdjusted && typeof parentPos === 'number') {
      try {
        const latest = view.state
        const parentNode = latest.doc.nodeAt(parentPos)
        const newItemPos = parentNode ? positionOfListChild(parentNode, parentPos, splitMeta.newIndex) : null
        if (typeof newItemPos === 'number') {
          const newNode = latest.doc.nodeAt(newItemPos)
          if (newNode) {
            const para = newNode.childCount > 0 ? newNode.child(0) : null
            const caretPos = para ? newItemPos + 1 + para.content.size : newItemPos + newNode.nodeSize - 1
            const chainResult = editor?.chain?.().focus().setTextSelection({ from: caretPos, to: caretPos }).run()
            if (!chainResult) {
              const tr = latest.tr.setSelection(TextSelection.create(latest.doc, caretPos)).scrollIntoView()
              view.dispatch(tr)
            }
            finalCaretPos = caretPos
            selectionAdjusted = true
            pendingEmptyCaretRef.current = true
          }
        }
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[split-adjust] top-level caret resolve failed', error)
      }
    }

    const enforceEmptyCaret = () => {
      try {
        if (typeof parentPos !== 'number') return
        const latest = view.state
        const parentNode = latest.doc.nodeAt(parentPos)
        if (!parentNode) return
        if (splitMeta.newIndex >= parentNode.childCount) return
        const newItemPos = positionOfListChild(parentNode, parentPos, splitMeta.newIndex)
        if (typeof newItemPos !== 'number') return
        const newNode = latest.doc.nodeAt(newItemPos)
        const para = newNode?.childCount ? newNode.child(0) : null
        const isEmpty = para?.type?.name === 'paragraph' && para.content.size === 0
        if (!isEmpty) return
        const resolvedDepth = Math.max(0, listItemDepth - 1)
        const currentIndex = latest.selection.$from.index(resolvedDepth)
        if (currentIndex !== splitMeta.newIndex + 1) return
        const caretPos = para ? newItemPos + 1 + para.content.size : newItemPos + newNode.nodeSize - 1
        const chainResult = editor?.chain?.().focus().setTextSelection({ from: caretPos, to: caretPos }).run()
        if (!chainResult) {
          const tr = latest.tr.setSelection(TextSelection.create(latest.doc, caretPos)).scrollIntoView()
          view.dispatch(tr)
        }
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[split-adjust] enforce caret failed', error)
      }
    }

    if (!selectionAdjusted) {
      if (typeof window !== 'undefined') window.requestAnimationFrame(enforceEmptyCaret)
      setTimeout(enforceEmptyCaret, 0)
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
