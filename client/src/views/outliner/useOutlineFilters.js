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

export function useOutlineFilters() {
  const [showFuture, setShowFuture] = useState(() => loadFutureVisible())
  const [showSoon, setShowSoon] = useState(() => loadSoonVisible())
  const [showArchived, setShowArchived] = useState(() => loadArchivedVisible())
  const [statusFilter, setStatusFilter] = useState(() => loadStatusFilter())
  const [tagFilters, setTagFilters] = useState(() => loadTagFilters())
  const [includeTagInput, setIncludeTagInput] = useState('')
  const [excludeTagInput, setExcludeTagInput] = useState('')

  const statusFilterRef = useRef(statusFilter)
  const showFutureRef = useRef(showFuture)
  const showSoonRef = useRef(showSoon)
  const showArchivedRef = useRef(showArchived)
  const tagFiltersRef = useRef(tagFilters)

  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { showFutureRef.current = showFuture }, [showFuture])
  useEffect(() => { showSoonRef.current = showSoon }, [showSoon])
  useEffect(() => { showArchivedRef.current = showArchived }, [showArchived])
  useEffect(() => { tagFiltersRef.current = tagFilters }, [tagFilters])

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

  const handleTagInputChange = useCallback((mode) => (event) => {
    const value = event.target.value
    if (mode === 'include') setIncludeTagInput(value)
    else setExcludeTagInput(value)
  }, [])

  const handleTagInputKeyDown = useCallback((mode) => (event) => {
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
