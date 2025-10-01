import { escapeForRegex } from './urlUtils.js'

/**
 * Apply search highlighting to the editor
 * @param {Object} editor - TipTap editor instance
 * @param {Object} searchQueryRef - Ref containing the search query
 * @param {Object} suppressSelectionRestoreRef - Ref to suppress selection restore
 */
export function applySearchHighlight(editor, searchQueryRef, suppressSelectionRestoreRef) {
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
}

