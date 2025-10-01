import { parseTagInput } from './tagUtils.js'

/**
 * Add a tag filter (include or exclude)
 * @param {string} mode - 'include' or 'exclude'
 * @param {string} value - Tag value to add
 * @param {Function} setTagFilters - State setter for tag filters
 * @returns {boolean} True if tag was added, false otherwise
 */
export function addTagFilter(mode, value, setTagFilters) {
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
}

/**
 * Remove a tag filter (include or exclude)
 * @param {string} mode - 'include' or 'exclude'
 * @param {string} tag - Tag to remove
 * @param {Function} setTagFilters - State setter for tag filters
 * @returns {boolean} True if tag was removed, false otherwise
 */
export function removeTagFilter(mode, tag, setTagFilters) {
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
}

/**
 * Clear all tag filters
 * @param {Function} setTagFilters - State setter for tag filters
 * @param {Function} setIncludeTagInput - State setter for include tag input
 * @param {Function} setExcludeTagInput - State setter for exclude tag input
 */
export function clearTagFilters(setTagFilters, setIncludeTagInput, setExcludeTagInput) {
  setTagFilters(prev => {
    const include = Array.isArray(prev?.include) ? prev.include : []
    const exclude = Array.isArray(prev?.exclude) ? prev.exclude : []
    if (!include.length && !exclude.length) return prev
    return { include: [], exclude: [] }
  })
  setIncludeTagInput('')
  setExcludeTagInput('')
}

/**
 * Handle tag input change
 * @param {string} mode - 'include' or 'exclude'
 * @param {Event} event - Input change event
 * @param {Function} setIncludeTagInput - State setter for include tag input
 * @param {Function} setExcludeTagInput - State setter for exclude tag input
 */
export function handleTagInputChange(mode, event, setIncludeTagInput, setExcludeTagInput) {
  const value = event.target.value
  if (mode === 'include') setIncludeTagInput(value)
  else setExcludeTagInput(value)
}

/**
 * Handle tag input key down
 * @param {string} mode - 'include' or 'exclude'
 * @param {Event} event - Keyboard event
 * @param {Function} addTagFilterFn - Function to add tag filter
 * @param {Function} getInputValue - Function to get current input value
 * @param {Function} setInputValue - Function to set input value
 */
export function handleTagInputKeyDown(mode, event, addTagFilterFn, getInputValue, setInputValue) {
  if (event.key === 'Enter') {
    event.preventDefault()
    const value = getInputValue()
    if (!value.trim()) return
    const added = addTagFilterFn(mode, value)
    if (added) setInputValue('')
  } else if (event.key === 'Escape') {
    event.preventDefault()
    setInputValue('')
  }
}

/**
 * Handle tag input blur
 * @param {string} mode - 'include' or 'exclude'
 * @param {Event} event - Blur event
 * @param {Function} addTagFilterFn - Function to add tag filter
 * @param {Function} getInputValue - Function to get current input value
 * @param {Function} setInputValue - Function to set input value
 */
export function handleTagInputBlur(mode, event, addTagFilterFn, getInputValue, setInputValue) {
  const value = getInputValue()
  if (!value.trim()) return
  const added = addTagFilterFn(mode, value)
  if (added) setInputValue('')
}

