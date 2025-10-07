import { TextSelection } from 'prosemirror-state'

/**
 * Ensure the caret is positioned at the given document offset.
 * Falls back to dispatching a transaction if chain().setTextSelection fails.
 * @param {Object} params
 * @param {Object} params.editor - TipTap editor instance
 * @param {Object} [params.view] - ProseMirror view (defaults to editor.view)
 * @param {number} params.pos - Document position for the caret
 * @returns {boolean} True if the operation ran, false otherwise
 */
export function setCaretSelection({ editor, view = editor?.view, pos }) {
  if (!editor || !view || typeof pos !== 'number') return false
  const state = view.state || editor.state
  if (!state || !state.doc) return false
  const docSize = state.doc.content.size
  const clamped = Math.max(0, Math.min(pos, docSize))
  try {
    const chain = editor.chain?.()
    const focused = chain?.focus?.()
    const ran = focused?.setTextSelection?.({ from: clamped, to: clamped })?.run?.()
    if (!ran) {
      const tr = state.tr.setSelection(TextSelection.create(state.doc, clamped)).scrollIntoView()
      view.dispatch(tr)
    }
    return true
  } catch (error) {
    if (typeof console !== 'undefined') {
      console.warn('[selection] failed to set caret', error)
    }
    return false
  }
}
