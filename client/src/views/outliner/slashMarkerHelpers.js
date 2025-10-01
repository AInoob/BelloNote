// ============================================================================
// Slash Marker Helper Functions
// Functions for managing the slash character marker in the editor
// ============================================================================

/**
 * Consumes the slash marker and query text from the document
 * Returns information about what was removed for command execution
 * @param {Object} params - Parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {Object} params.slashQueryRef - Ref containing current slash query
 * @param {Object} params.slashMarkerRef - Ref containing slash marker position
 * @param {Function} params.setSlashQuery - Function to update slash query state
 * @param {Function} params.pushDebug - Debug logging function
 * @returns {Object|null} Removed text info with from/to positions and source, or null
 */
export function consumeSlashMarker({
  editor,
  slashQueryRef,
  slashMarkerRef,
  setSlashQuery,
  pushDebug
}) {
  if (!editor) return null
  const query = slashQueryRef.current
  const { state } = editor
  const { $from } = state.selection
  const queryLength = query.length
  const suffix = `/${query}`
  let from = null
  let to = null
  let source = 'cursor'

  if ($from.parent?.isTextblock) {
    try {
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\uFFFC', '\uFFFC')
      if (textBefore && textBefore.endsWith(suffix)) {
        const startOffset = $from.parentOffset - suffix.length
        if (startOffset >= 0) {
          from = $from.start() + startOffset
          to = from + suffix.length
        }
      }
    } catch (err) {
      pushDebug('popup: inspect textBefore failed', { error: err.message })
    }
  }

  if (from === null) {
    const marker = slashMarkerRef.current
    if (!marker) {
      pushDebug('popup: no slash marker to consume')
      setSlashQuery('')
      return null
    }
    from = marker.pos
    const docSize = state.doc.content.size
    const probeEnd = Math.min(marker.pos + 1 + query.length, docSize)
    const slice = state.doc.textBetween(marker.pos, probeEnd, '\n', '\n') || ''
    if (queryLength && slice.startsWith('/' + query)) {
      to = marker.pos + 1 + queryLength
    } else {
      to = marker.pos + 1
    }
    source = 'marker'
  }

  let removed = null
  try {
    pushDebug('popup: doc before slash removal', { doc: editor.getJSON() })
    const ok = editor.chain().focus().deleteRange({ from, to }).run()
    if (ok) {
      removed = { from, to }
      pushDebug('popup: removed slash marker', { from, to, source })
    } else {
      pushDebug('popup: remove slash marker skipped', { from, to, source })
    }
    pushDebug('popup: doc after slash removal', { doc: editor.getJSON() })
  } catch (e) {
    pushDebug('popup: remove slash marker failed', { error: e.message })
  }

  slashMarkerRef.current = null
  setSlashQuery('')
  return removed
}

/**
 * Removes a dangling slash character at specified position
 * @param {Editor} editor - TipTap editor instance
 * @param {Function} pushDebug - Debug logging function
 * @param {number} from - Position to check and clean
 */
export function cleanDanglingSlash(editor, pushDebug, from) {
  if (!editor) return
  const char = editor.state.doc.textBetween(from, from + 1, '\n', '\n')
  if (char !== '/') return
  try {
    editor.chain().focus().deleteRange({ from, to: from + 1 }).run()
    pushDebug('popup: cleaned dangling slash', { from })
  } catch (e) {
    pushDebug('popup: clean dangling slash failed', { error: e.message })
  }
}
