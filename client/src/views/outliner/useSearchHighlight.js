// ============================================================================
// Search Highlighting Hook
// React hook for applying search highlighting to the editor
// ============================================================================

import { useCallback, useEffect } from 'react'

/**
 * Escapes special regex characters in a string
 * @param {string} value - String to escape
 * @returns {string} Escaped string safe for use in regex
 */
const escapeForRegex = (value = '') => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

/**
 * Custom hook for handling search highlighting in the outline editor
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {string} params.searchQuery - Current search query
 * @param {React.RefObject} params.searchQueryRef - Ref to search query for stable access
 * @param {React.RefObject} params.suppressSelectionRestoreRef - Ref to skip selection restore flag
 * @returns {Object} Search highlight utilities
 */
export function useSearchHighlight({ editor, searchQuery, searchQueryRef, suppressSelectionRestoreRef }) {
  /**
   * Applies search highlighting to matching text in the editor
   * Highlights all instances of the search query with yellow background
   * Preserves selection when applying highlights
   */
  const applySearchHighlight = useCallback(() => {
    if (!editor) return
    const { state } = editor
    const { doc, selection } = state
    const highlightMark = editor.schema.marks.highlight
    if (!highlightMark) return

    // Remove all existing highlights first
    let tr = state.tr.removeMark(0, doc.content.size, highlightMark)
    const query = searchQueryRef.current.trim()
    const shouldRestoreSelection = !suppressSelectionRestoreRef.current

    // If no query, just remove highlights and return
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

    // Build regex from query (case insensitive)
    let regex
    try {
      regex = new RegExp(escapeForRegex(query), 'gi')
    } catch {
      // Invalid regex, just remove highlights
      tr.setMeta('addToHistory', false)
      if (shouldRestoreSelection) {
        tr.setSelection(selection.map(tr.doc, tr.mapping))
      } else {
        suppressSelectionRestoreRef.current = false
      }
      editor.view.dispatch(tr)
      return
    }

    // Find and highlight all matches
    doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text || ''
      let match
      while ((match = regex.exec(text)) !== null) {
        const from = pos + match.index
        const to = from + match[0].length
        tr = tr.addMark(from, to, highlightMark.create({ color: '#fde68a' })) // Yellow highlight
      }
    })

    tr.setMeta('addToHistory', false) // Don't add highlight changes to undo history
    if (shouldRestoreSelection) {
      tr.setSelection(selection.map(tr.doc, tr.mapping))
    } else {
      suppressSelectionRestoreRef.current = false
    }
    editor.view.dispatch(tr)
  }, [editor, searchQueryRef, suppressSelectionRestoreRef])

  // Apply highlights when search query changes
  useEffect(() => {
    if (!editor) return
    applySearchHighlight()
  }, [editor, applySearchHighlight, searchQuery])

  // Re-apply highlights after editor updates (maintains highlights during edits)
  useEffect(() => {
    if (!editor) return
    const handler = () => applySearchHighlight()
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor, applySearchHighlight])

  return {
    applySearchHighlight
  }
}
