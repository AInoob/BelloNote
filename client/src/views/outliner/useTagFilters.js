// ============================================================================
// Tag Filters Hook
// Manages tag-based filtering state and input handlers
// ============================================================================

import { useState, useCallback } from 'react'
import { parseTagInput } from './tagUtils.js'

const DEFAULT_TAG_FILTER = { include: [], exclude: [] }

export function useTagFilters({ tagFiltersRef }) {
  const [includeTagInput, setIncludeTagInput] = useState('')
  const [excludeTagInput, setExcludeTagInput] = useState('')

  const addTagFilter = useCallback((mode, value, setTagFilters) => {
    const parsed = parseTagInput(value)
    if (!parsed) return false
    let added = false
    setTagFilters(prev => {
      const current = prev && typeof prev === 'object'
        ? prev
        : { include: [], exclude: [] }
      const includeSet = new Set(Array.isArray(current.include) ? current.include : [])
      const excludeSet = new Set(Array.isArray(current.exclude) ? current.exclude : [])
      if (mode === 'include') {
        if (includeSet.has(parsed.canonical)) return current
        includeSet.add(parsed.canonical)
        excludeSet.delete(parsed.canonical)
      } else {
        if (excludeSet.has(parsed.canonical)) return current
        excludeSet.add(parsed.canonical)
        includeSet.delete(parsed.canonical)
      }
      added = true
      return {
        include: Array.from(includeSet).sort((a, b) => a.localeCompare(b)),
        exclude: Array.from(excludeSet).sort((a, b) => a.localeCompare(b))
      }
    })
    return added
  }, [])

  const removeTagFilter = useCallback((mode, tag, setTagFilters) => {
    const canonical = typeof tag === 'string' ? tag.toLowerCase() : ''
    if (!canonical) return false
    let removed = false
    setTagFilters(prev => {
      const current = prev && typeof prev === 'object'
        ? prev
        : { include: [], exclude: [] }
      const include = Array.isArray(current.include) ? current.include : []
      const exclude = Array.isArray(current.exclude) ? current.exclude : []
      if (mode === 'include') {
        if (!include.includes(canonical)) return current
        removed = true
        return { include: include.filter(t => t !== canonical), exclude: [...exclude] }
      }
      if (!exclude.includes(canonical)) return current
      removed = true
      return { include: [...include], exclude: exclude.filter(t => t !== canonical) }
    })
    return removed
  }, [])

  const clearTagFilters = useCallback((setTagFilters) => {
    setTagFilters(prev => {
      const include = Array.isArray(prev?.include) ? prev.include : []
      const exclude = Array.isArray(prev?.exclude) ? prev.exclude : []
      if (!include.length && !exclude.length) return prev
      return { include: [], exclude: [] }
    })
    setIncludeTagInput('')
    setExcludeTagInput('')
  }, [])

  const handleTagInputChange = useCallback((mode) => (event) => {
    const value = event.target.value
    if (mode === 'include') setIncludeTagInput(value)
    else setExcludeTagInput(value)
  }, [])

  const handleTagInputKeyDown = useCallback((mode, setTagFilters) => (event) => {
    const commitKeys = ['Enter', 'Tab', ',', ' ']
    if (commitKeys.includes(event.key)) {
      const value = event.currentTarget.value
      const added = addTagFilter(mode, value, setTagFilters)
      if (added) {
        event.preventDefault()
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      } else if (event.key !== 'Tab') {
        event.preventDefault()
      }
      return
    }
    if (event.key === 'Backspace' && !event.currentTarget.value) {
      const current = tagFiltersRef.current || DEFAULT_TAG_FILTER
      const list = Array.isArray(current[mode]) ? current[mode] : []
      if (list.length) {
        event.preventDefault()
        removeTagFilter(mode, list[list.length - 1], setTagFilters)
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      }
      return
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }, [addTagFilter, removeTagFilter, tagFiltersRef])

  const handleTagInputBlur = useCallback((mode, setTagFilters) => (event) => {
    const value = event.currentTarget.value
    const trimmed = value.trim()
    if (!trimmed) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
      return
    }
    const added = addTagFilter(mode, trimmed, setTagFilters)
    if (added) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
    }
  }, [addTagFilter])

  return {
    includeTagInput,
    setIncludeTagInput,
    excludeTagInput,
    setExcludeTagInput,
    addTagFilter,
    removeTagFilter,
    clearTagFilters,
    handleTagInputChange,
    handleTagInputKeyDown,
    handleTagInputBlur
  }
}
