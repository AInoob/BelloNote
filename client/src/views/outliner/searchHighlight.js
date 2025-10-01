export function applySearchHighlight(editor, {
  query,
  suppressSelectionRestoreRef,
  escapeForRegex,
  highlightColor = '#fde68a'
}) {
  if (!editor) return
  const { state } = editor
  const { doc, selection } = state
  const highlightMark = editor.schema.marks.highlight
  if (!highlightMark) return

  let tr = state.tr.removeMark(0, doc.content.size, highlightMark)
  const trimmedQuery = (query || '').trim()
  const shouldRestoreSelection = !suppressSelectionRestoreRef?.current

  if (!trimmedQuery) {
    tr.setMeta('addToHistory', false)
    if (shouldRestoreSelection) {
      tr.setSelection(selection.map(tr.doc, tr.mapping))
    } else if (suppressSelectionRestoreRef) {
      suppressSelectionRestoreRef.current = false
    }
    editor.view.dispatch(tr)
    return
  }

  let regex
  try {
    regex = new RegExp(escapeForRegex ? escapeForRegex(trimmedQuery) : trimmedQuery, 'gi')
  } catch {
    tr.setMeta('addToHistory', false)
    if (shouldRestoreSelection) {
      tr.setSelection(selection.map(tr.doc, tr.mapping))
    } else if (suppressSelectionRestoreRef) {
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
      tr = tr.addMark(from, to, highlightMark.create({ color: highlightColor }))
    }
  })

  tr.setMeta('addToHistory', false)
  if (shouldRestoreSelection) {
    tr.setSelection(selection.map(tr.doc, tr.mapping))
  } else if (suppressSelectionRestoreRef) {
    suppressSelectionRestoreRef.current = false
  }
  editor.view.dispatch(tr)
}
