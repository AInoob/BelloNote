// ============================================================================
// Editor Props Factory
// Creates the editorProps configuration for TipTap editor
// Handles all keyboard, paste, and text input events
// ============================================================================

import { extractOutlineClipboardPayload } from '../../utils/outlineClipboard.js'
import { handleEnterKey } from './enterKeyHandler.js'

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

export function createEditorProps({
  isReadOnly,
  editor,
  pushDebug,
  slashHandlersRef,
  focusRootRef,
  pendingFocusScrollRef,
  setFocusRootId,
  onRequestTimelineFocus,
  computeActiveTask,
  markDirty,
  doSave,
  runSplitListItemWithSelection,
  applySplitStatusAdjustments,
  promoteSplitSiblingToChild,
  runListIndentCommand,
  moveIntoFirstChild,
  logCursorTiming,
  suppressSelectionRestoreRef,
  pendingEmptyCaretRef
}) {
  return {
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
          void doSave()
          pushDebug('paste: outline slice inserted', { openStart: slice.openStart, openEnd: slice.openEnd })
          return true
        }
      }

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
        return handleEnterKey({
          event,
          editor,
          pushDebug,
          logCursorTiming,
          runSplitListItemWithSelection,
          applySplitStatusAdjustments,
          promoteSplitSiblingToChild,
          suppressSelectionRestoreRef,
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
  }
}
