import { Fragment } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { STATUS_EMPTY } from './constants.js'
import {
  findListItemDepth,
  runListIndentCommand,
  runSplitListItemWithSelection,
  applySplitStatusAdjustments,
  promoteSplitSiblingToChild
} from './listCommands.js'

function moveIntoFirstChild(view) {
  const { state } = view
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'listItem') {
      const inParagraph = $from.parent.type.name === 'paragraph'
      const atEnd = $from.parentOffset === $from.parent.content.size
      const collapsed = node.attrs?.collapsed
      if (!inParagraph || !atEnd || collapsed) return false
      let childIndex = -1
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i)
        if (child.type.name === 'bulletList' && child.childCount > 0) {
          childIndex = i
          break
        }
      }
      if (childIndex === -1) return false
      const listItemStart = $from.before(depth)
      let offset = 1
      for (let i = 0; i < childIndex; i += 1) offset += node.child(i).nodeSize
      const firstLiStart = listItemStart + offset + 1
      const target = firstLiStart + 1
      const tr = state.tr.setSelection(TextSelection.create(state.doc, target))
      view.dispatch(tr.scrollIntoView())
      return true
    }
  }
  return false
}

export function handleEditorKeyDown({
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
  scheduleApplyStatusFilter,
  logCursorTiming
}) {
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

  if (event.key === 'ArrowDown') {
    if (moveIntoFirstChild(view)) {
      event.preventDefault()
      pushDebug('moveIntoFirstChild')
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
    const { state, view: currentView } = editor
    const { $from } = currentView.state.selection
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
      currentView.dispatch(tr.scrollIntoView())
      if (selectionTarget !== null) {
        const mappedPos = tr.mapping.map(selectionTarget, 1)
        try {
          const latest = currentView.state
          const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
          const resolved = latest.doc.resolve(clamped)
          const targetSelection = TextSelection.near(resolved, -1)
          currentView.dispatch(latest.tr.setSelection(targetSelection))
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[split-adjust] empty sibling selection restore failed', error)
        }
      }
      currentView.focus()
      requestAnimationFrame(() => currentView.focus())
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
        currentView.dispatch(tr.scrollIntoView())
        if (selectionTarget !== null) {
          const mappedPos = tr.mapping.map(selectionTarget, 1)
          try {
            const latest = currentView.state
            const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
            const resolved = latest.doc.resolve(clamped)
            const targetSelection = TextSelection.near(resolved, -1)
            currentView.dispatch(latest.tr.setSelection(targetSelection))
          } catch (error) {
            if (typeof console !== 'undefined') console.warn('[split-adjust] collapsed sibling selection restore failed', error)
          }
        }
        currentView.focus()
        requestAnimationFrame(() => currentView.focus())
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
      currentView.dispatch(tr.scrollIntoView())
      if (selectionTarget !== null) {
        const mappedPos = tr.mapping.map(selectionTarget, 1)
        try {
          const latest = currentView.state
          const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
          const resolved = latest.doc.resolve(clamped)
          const targetSelection = TextSelection.near(resolved, -1)
          currentView.dispatch(latest.tr.setSelection(targetSelection))
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[split-adjust] selection restore failed', error)
        }
      }
      currentView.focus()
      requestAnimationFrame(() => currentView.focus())
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
      currentView.dispatch(tr)
      if (selectionTarget !== null) {
        const mappedPos = tr.mapping.map(selectionTarget, 1)
        try {
          const latest = currentView.state
          const clamped = Math.max(0, Math.min(mappedPos, latest.doc.content.size))
          const resolved = latest.doc.resolve(clamped)
          const targetSelection = TextSelection.near(resolved, -1)
          currentView.dispatch(latest.tr.setSelection(targetSelection))
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[split-adjust] prepend selection restore failed', error)
        }
      }
      currentView.focus()
      requestAnimationFrame(() => currentView.focus())
      logCursorTiming('prepend-child', enterStartedAt)
      return true
    }

    const paragraphEndPos = listItemPos + 1 + paragraphNode.nodeSize - 1
    if (offset !== paragraphNode.content.size) {
      const endSelection = TextSelection.create(currentView.state.doc, paragraphEndPos)
      currentView.dispatch(state.tr.setSelection(endSelection))
      currentView.focus()
      requestAnimationFrame(() => currentView.focus())
      logCursorTiming('split-internal', enterStartedAt)
      return true
    }

    const originalIndex = $from.index(listItemDepth)
    const splitMeta = {
      parentPos,
      originalIndex,
      newIndex: originalIndex + 1,
      originalAttrs
    }
    const didSplit = runSplitListItemWithSelection(editor, { splitAtStart: false })
    if (!didSplit) {
      return false
    }

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
      currentView.focus()
      requestAnimationFrame(() => currentView.focus())
      scheduleApplyStatusFilter('enter')
      logCursorTiming('append-child-from-parent', enterStartedAt)
      return true
    }

    let selectionAdjusted = false
    let finalCaretPos = null
    if (isChild && typeof parentPos === 'number') {
      try {
        const latest = currentView.state
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
          if (suppressSelectionRestoreRef) suppressSelectionRestoreRef.current = true
          if (pendingEmptyCaretRef) pendingEmptyCaretRef.current = true
        }
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[split-adjust] child caret restore failed', error)
      }
    }

    currentView.focus()
    requestAnimationFrame(() => currentView.focus())
    if (selectionAdjusted) {
      const applyCaretSelection = () => {
        try {
          const refreshed = currentView.state
          const clamped = Math.max(0, Math.min(finalCaretPos ?? 0, refreshed.doc.content.size))
          const chainResult = editor?.chain?.().focus().setTextSelection({ from: clamped, to: clamped }).run()
          if (!chainResult) {
            const tr = refreshed.tr.setSelection(TextSelection.create(refreshed.doc, clamped)).scrollIntoView()
            currentView.dispatch(tr)
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
    scheduleApplyStatusFilter('enter')
    logCursorTiming('split-list-item', enterStartedAt)
    return true
  }

  if (event.key === 'Tab') {
    const { state: currentState } = editor
    const inCode = currentState.selection.$from.parent.type.name === 'codeBlock'
    if (inCode) return false
    event.preventDefault()
    const direction = event.shiftKey ? 'lift' : 'sink'
    const focusEmpty = () => {
      if (!pendingEmptyCaretRef?.current) return
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
      scheduleApplyStatusFilter('tab')
      return true
    }
    pushDebug('indentation-failed', { shift: event.shiftKey })
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
