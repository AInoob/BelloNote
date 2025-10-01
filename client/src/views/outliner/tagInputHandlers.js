import { DEFAULT_TAG_FILTER } from './filterUtils.js'

/**
 * Handle tag input key down event
 * @param {string} mode - Filter mode ('include' or 'exclude')
 * @param {KeyboardEvent} event - Keyboard event
 * @param {Function} addTagFilter - Function to add tag filter
 * @param {Function} removeTagFilter - Function to remove tag filter
 * @param {Function} setIncludeTagInput - Function to set include tag input
 * @param {Function} setExcludeTagInput - Function to set exclude tag input
 * @param {Object} tagFiltersRef - Ref to tag filters
 */
export function handleTagInputKeyDown(
  mode,
  event,
  addTagFilter,
  removeTagFilter,
  setIncludeTagInput,
  setExcludeTagInput,
  tagFiltersRef
) {
  const commitKeys = ['Enter', 'Tab', ',', ' ']
  if (commitKeys.includes(event.key)) {
    const value = event.currentTarget.value
    const added = addTagFilter(mode, value)
    if (added) {
      event.preventDefault()
      if (mode === 'include') setIncludeTagInput('')
      else setExcludeTagInput('')
    } else if (event.key !== 'Tab') {
      // Prevent stray characters when value is empty or invalid
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
    return
  }
  if (event.key === 'Escape') {
    event.currentTarget.blur()
  }
}

/**
 * Handle tag input blur event
 * @param {string} mode - Filter mode ('include' or 'exclude')
 * @param {FocusEvent} event - Blur event
 * @param {Function} addTagFilter - Function to add tag filter
 * @param {Function} setIncludeTagInput - Function to set include tag input
 * @param {Function} setExcludeTagInput - Function to set exclude tag input
 */
export function handleTagInputBlur(
  mode,
  event,
  addTagFilter,
  setIncludeTagInput,
  setExcludeTagInput
) {
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
}

