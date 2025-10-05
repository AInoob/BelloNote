import { isLikelyUrl, normalizeUrl } from './urlUtils.js'
import { extractOutlineClipboardPayload } from '../../utils/outlineClipboard.js'
import { stripHighlightMarksFromDoc } from './highlightCleanup.js'

/**
 * Handle paste event in the editor
 * @param {Object} view - ProseMirror view
 * @param {ClipboardEvent} event - Paste event
 * @param {Object} editor - TipTap editor instance
 * @param {Function} markDirty - Function to mark dirty
 * @param {Object} saveTimer - Ref to save timer
 * @param {Function} doSave - Function to save
 * @param {Function} pushDebug - Function to push debug message
 * @returns {boolean} True if handled, false otherwise
 */
export function handlePaste(view, event, editor, markDirty, saveTimer, doSave, pushDebug) {
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
      const cleanDoc = stripHighlightMarksFromDoc(result.payload.doc)
      editor?.commands?.setContent(cleanDoc, true)
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
}
