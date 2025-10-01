// ============================================================================
// Outline Filters Hook
// React hook for managing all outline filter state and handlers
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_STATUS_FILTER,
  DEFAULT_TAG_FILTER,
  loadArchivedVisible,
  loadFutureVisible,
  loadSoonVisible,
  loadStatusFilter,
  loadTagFilters
} from './filterPreferences.js'
import { parseTagInput } from './tagUtils.js'

/**
 * Custom hook for managing outline filter state
 * Handles status filters, visibility toggles, and tag filters
 * @returns {Object} Filter state, setters, refs, and handlers
 */
export function useOutlineFilters() {
  const [showFuture, setShowFuture] = useState(() => loadFutureVisible())
  const [showSoon, setShowSoon] = useState(() => loadSoonVisible())
  const [showArchived, setShowArchived] = useState(() => loadArchivedVisible())
  const [statusFilter, setStatusFilter] = useState(() => loadStatusFilter())
  const [tagFilters, setTagFilters] = useState(() => loadTagFilters())
  const [includeTagInput, setIncludeTagInput] = useState('')
  const [excludeTagInput, setExcludeTagInput] = useState('')

  // Refs for accessing current filter state in event handlers
  const statusFilterRef = useRef(statusFilter)
  const showFutureRef = useRef(showFuture)
  const showSoonRef = useRef(showSoon)
  const showArchivedRef = useRef(showArchived)
  const tagFiltersRef = useRef(tagFilters)

  // Keep refs in sync with state
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { showFutureRef.current = showFuture }, [showFuture])
  useEffect(() => { showSoonRef.current = showSoon }, [showSoon])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  useEffect(() => { tagFiltersRef.current = tagFilters }, [tagFilters])

  // ============================================================================
  // Tag Filter Management
  // ============================================================================

  /**
   * Adds a tag to the include or exclude filter list
   * Removes tag from opposite list if present
   * @param {string} mode - 'include' or 'exclude'
   * @param {string} value - Tag value to add
   * @returns {boolean} True if tag was added
   */
  const addTagFilter = useCallback((mode, value) => {
    const parsed = parseTagInput(value)
    if (!parsed) return false
    let added = false
    setTagFilters((prev) => {
      const current = prev && typeof prev === 'object' ? prev : DEFAULT_TAG_FILTER
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

  /**
   * Removes a tag from the include or exclude filter list
   * @param {string} mode - 'include' or 'exclude'
   * @param {string} tag - Canonical tag to remove
   * @returns {boolean} True if tag was removed
   */
  const removeTagFilter = useCallback((mode, tag) => {
    const canonical = typeof tag === 'string' ? tag.toLowerCase() : ''
    if (!canonical) return false
    let removed = false
    setTagFilters((prev) => {
      const current = prev && typeof prev === 'object' ? prev : DEFAULT_TAG_FILTER
      const include = Array.isArray(current.include) ? current.include : []
      const exclude = Array.isArray(current.exclude) ? current.exclude : []
      if (mode === 'include') {
        if (!include.includes(canonical)) return current
        removed = true
        return { include: include.filter((item) => item !== canonical), exclude: [...exclude] }
      }
      if (!exclude.includes(canonical)) return current
      removed = true
      return { include: [...include], exclude: exclude.filter((item) => item !== canonical) }
    })
    return removed
  }, [])

  /**
   * Clears all tag filters (both include and exclude)
   * Also clears input field values
   */
  const clearTagFilters = useCallback(() => {
    setTagFilters((prev) => {
      const include = Array.isArray(prev?.include) ? prev.include : []
      const exclude = Array.isArray(prev?.exclude) ? prev.exclude : []
      if (!include.length && !exclude.length) return prev
      return { include: [], exclude: [] }
    })
    setIncludeTagInput('')
    setExcludeTagInput('')
  }, [])

  // ============================================================================
  // Tag Input Handlers
  // ============================================================================

  /**
   * Creates onChange handler for tag filter input
   * @param {string} mode - 'include' or 'exclude'
   * @returns {Function} Event handler
   */
  const handleTagInputChange = useCallback((mode) => (event) => {
    const value = event.target.value
    if (mode === 'include') setIncludeTagInput(value)
    else setExcludeTagInput(value)
  }, [])

  /**
   * Creates onKeyDown handler for tag filter input
   * Commits tag on Enter/Tab/comma/space, removes last tag on Backspace when empty
   * @param {string} mode - 'include' or 'exclude'
   * @returns {Function} Event handler
   */
  const handleTagInputKeyDown = useCallback((mode) => (event) => {
    // Commit current input to tag list on these keys
    const commitKeys = ['Enter', 'Tab', ',', ' ']
    if (commitKeys.includes(event.key)) {
      const value = event.currentTarget.value
      const added = addTagFilter(mode, value)
      if (added) {
        event.preventDefault()
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      } else if (event.key !== 'Tab') {
        event.preventDefault()
      }
      return
    }

    // Remove last tag on backspace when input is empty
    if (event.key === 'Backspace' && !event.currentTarget.value) {
      const current = tagFiltersRef.current || DEFAULT_TAG_FILTER
      const list = Array.isArray(current[mode]) ? current[mode] : []
      if (list.length) {
        event.preventDefault()
        removeTagFilter(mode, list[list.length - 1])
        if (mode === 'include') setIncludeTagInput('')
        else setExcludeTagInput('')
      }
    }
  }, [addTagFilter, removeTagFilter])

  /**
   * Creates onBlur handler for tag filter input
   * Commits any remaining input value as a tag
   * @param {string} mode - 'include' or 'exclude'
   * @returns {Function} Event handler
   */
  const handleTagInputBlur = useCallback((mode) => (event) => {
    const value = event.currentTarget.value
    const trimmed = value.trim()
    if (!trimmed) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
      return
    }
    const added = addTagFilter(mode, trimmed)
    if (added) {
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
    }
  }, [addTagFilter])

  return {
    showFuture,
    setShowFuture,
    showFutureRef,
    showSoon,
    setShowSoon,
    showSoonRef,
    showArchived,
    setShowArchived,
    showArchivedRef,
    statusFilter,
    setStatusFilter,
    statusFilterRef,
    tagFilters,
    setTagFilters,
    tagFiltersRef,
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
