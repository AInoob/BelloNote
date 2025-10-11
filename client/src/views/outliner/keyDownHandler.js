import { handleEnterKey } from './enterKeyHandler.js'
import { setCaretSelection } from './editorSelectionUtils.js'
import { runListIndentCommand, findListItemDepth } from './listCommands.js'
import { moveIntoFirstChild } from './editorNavigation.js'
import { now, logCursorTiming } from './performanceUtils.js'
import { STATUS_EMPTY, STATUS_ORDER } from './constants.js'

function cycleActiveTaskStatus(editor) {
  if (!editor) return false
  const { state, view } = editor
  if (!state || !view) return false
  const { $from } = state.selection
  const listItemDepth = findListItemDepth($from)
  if (listItemDepth <= 0) return false
  const listItemPos = $from.before(listItemDepth)
  if (typeof listItemPos !== 'number') return false
  const listItemNode = state.doc.nodeAt(listItemPos)
  if (!listItemNode) return false
  const currentStatus = typeof listItemNode.attrs?.status === 'string'
    ? listItemNode.attrs.status
    : STATUS_EMPTY
  const currentIndex = STATUS_ORDER.indexOf(currentStatus)
  const safeIndex = currentIndex >= 0 ? currentIndex : 0
  const nextStatus = STATUS_ORDER[(safeIndex + 1) % STATUS_ORDER.length]
  const tr = state.tr.setNodeMarkup(
    listItemPos,
    undefined,
    { ...listItemNode.attrs, status: nextStatus }
  )
  view.dispatch(tr)
  try {
    view.dom?.focus?.({ preventScroll: true })
  } catch {
    view.focus?.()
  }
  return true
}

/**
 * Handle key down event in the editor
 * @param {Object} view - ProseMirror view
 * @param {KeyboardEvent} event - Keyboard event
 * @param {Object} slashHandlersRef - Ref to slash handlers
 * @param {Object} focusRootRef - Ref to focus root
 * @param {Object} pendingFocusScrollRef - Ref to pending focus scroll
 * @param {Function} setFocusRootId - Function to set focus root ID
 * @param {Function} computeActiveTask - Function to compute active task
 * @param {Function} onRequestTimelineFocus - Callback for timeline focus request
 * @param {Object} editor - TipTap editor instance
 * @param {Object} pendingEmptyCaretRef - Ref to pending empty caret state
 * @param {Function} pushDebug - Function to push debug message
 * @returns {boolean} True if handled, false otherwise
 */
export function handleKeyDown(
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
) {
  if (typeof window !== 'undefined') {
    window.__KEYDOWN_TOTAL = (window.__KEYDOWN_TOTAL || 0) + 1
  }
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

  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && (event.key === 't' || event.key === 'T')) {
    event.preventDefault()
    event.stopPropagation()
    const changed = cycleActiveTaskStatus(editor)
    pushDebug(changed ? 'status-cycle:cmd-t' : 'status-cycle:cmd-t-failed')
    return changed
  }
  
  if (event.key === 'Enter') {
    if (typeof window !== 'undefined') {
      window.__ENTER_KEYDOWN_COUNT = (window.__ENTER_KEYDOWN_COUNT || 0) + 1
    }
    return handleEnterKey({
      event,
      editor,
      now,
      logCursorTiming,
      pushDebug,
      pendingEmptyCaretRef
    })
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
            setCaretSelection({ editor, view: curView, pos: caretPos })
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
    if (moveIntoFirstChild(view)) { 
      event.preventDefault()
      pushDebug('moveIntoFirstChild')
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
