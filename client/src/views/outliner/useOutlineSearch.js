import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySearchHighlight as applySearchHighlightToEditor } from './searchHighlight.js'

export function useOutlineSearch({ editor, escapeForRegex, suppressSelectionRestoreRef }) {
  const [query, setQuery] = useState('')
  const queryRef = useRef('')

  useEffect(() => {
    queryRef.current = query
  }, [query])

  const applySearchHighlight = useCallback(() => {
    applySearchHighlightToEditor(editor, {
      query: queryRef.current,
      suppressSelectionRestoreRef,
      escapeForRegex
    })
  }, [editor, escapeForRegex, suppressSelectionRestoreRef])

  useEffect(() => {
    if (!editor) return
    applySearchHighlight()
  }, [editor, applySearchHighlight, query])

  useEffect(() => {
    if (!editor) return
    const handler = () => applySearchHighlight()
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor, applySearchHighlight])

  const handleChange = useCallback((event) => {
    setQuery(event.target.value)
  }, [])

  const handleClear = useCallback(() => {
    setQuery('')
  }, [])

  return useMemo(() => ({
    searchQuery: query,
    handleSearchChange: handleChange,
    handleSearchClear: handleClear
  }), [query, handleChange, handleClear])
}
