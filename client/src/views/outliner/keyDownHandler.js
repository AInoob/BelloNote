import { handleEnterKey } from './enterKeyHandler.js'
import { setCaretSelection } from './editorSelectionUtils.js'
import { runListIndentCommand } from './listCommands.js'
import { moveIntoFirstChild } from './editorNavigation.js'
import { now, logCursorTiming } from './performanceUtils.js'

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
