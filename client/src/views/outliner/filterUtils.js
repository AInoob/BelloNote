/**
 * Utility functions for managing outline filters (status, archived, future, soon, tags)
 */

import {
  FILTER_STATUS_KEY,
  FILTER_ARCHIVED_KEY,
  FILTER_FUTURE_KEY,
  FILTER_SOON_KEY,
  FILTER_TAG_INCLUDE_KEY,
  FILTER_TAG_EXCLUDE_KEY
} from './constants.js'
import { parseTagInput } from './tagUtils.js'

/**
 * Default status filter - all statuses visible by default
 */
export const DEFAULT_STATUS_FILTER = { 
  none: true, 
  todo: true, 
  'in-progress': true, 
  done: true 
}

/**
 * Load status filter from localStorage
 * @returns {Object} Status filter object with boolean values for each status
 */
export const loadStatusFilter = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STATUS_KEY) || 'null')
    const obj = (raw && typeof raw === 'object') ? raw : {}
    return {
      none: typeof obj.none === 'boolean' ? obj.none : true,
      todo: typeof obj.todo === 'boolean' ? obj.todo : true,
      'in-progress': typeof obj['in-progress'] === 'boolean' ? obj['in-progress'] : true,
      done: typeof obj.done === 'boolean' ? obj.done : true,
    }
  } catch {
    return { ...DEFAULT_STATUS_FILTER }
  }
}

/**
 * Save status filter to localStorage
 * @param {Object} f - Status filter object
 */
export const saveStatusFilter = (f) => {
  try { 
    localStorage.setItem(FILTER_STATUS_KEY, JSON.stringify({ ...DEFAULT_STATUS_FILTER, ...(f||{}) })) 
  } catch {}
}

/**
 * Load archived visibility from localStorage
 * @returns {boolean} Whether archived items should be visible
 */
export const loadArchivedVisible = () => {
  try { 
    const v = localStorage.getItem(FILTER_ARCHIVED_KEY)
    return v === '0' ? false : true 
  } catch { 
    return true 
  }
}

/**
 * Save archived visibility to localStorage
 * @param {boolean} v - Whether archived items should be visible
 */
export const saveArchivedVisible = (v) => { 
  try { 
    localStorage.setItem(FILTER_ARCHIVED_KEY, v ? '1' : '0') 
  } catch {} 
}

/**
 * Load future visibility from localStorage
 * @returns {boolean} Whether future items should be visible
 */
export const loadFutureVisible = () => { 
  try { 
    const v = localStorage.getItem(FILTER_FUTURE_KEY)
    return v === '0' ? false : true 
  } catch { 
    return true 
  } 
}

/**
 * Save future visibility to localStorage
 * @param {boolean} v - Whether future items should be visible
 */
export const saveFutureVisible = (v) => { 
  try { 
    localStorage.setItem(FILTER_FUTURE_KEY, v ? '1' : '0') 
  } catch {} 
}

/**
 * Load soon visibility from localStorage
 * @returns {boolean} Whether soon items should be visible
 */
export const loadSoonVisible = () => { 
  try { 
    const v = localStorage.getItem(FILTER_SOON_KEY)
    return v === '0' ? false : true 
  } catch { 
    return true 
  } 
}

/**
 * Save soon visibility to localStorage
 * @param {boolean} v - Whether soon items should be visible
 */
export const saveSoonVisible = (v) => { 
  try { 
    localStorage.setItem(FILTER_SOON_KEY, v ? '1' : '0') 
  } catch {} 
}

/**
 * Default tag filter - no tags filtered
 */
export const DEFAULT_TAG_FILTER = { include: [], exclude: [] }

/**
 * Normalize an array of tag strings to canonical form
 * @param {Array} input - Array of tag strings
 * @returns {Array} Sorted array of canonical tag strings
 */
export const normalizeTagArray = (input) => {
  const set = new Set()
  if (Array.isArray(input)) {
    input.forEach(item => {
      if (typeof item !== 'string') return
      const parsed = parseTagInput(item)
      if (parsed) set.add(parsed.canonical)
    })
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/**
 * Load tag filters from localStorage
 * @returns {Object} Tag filter object with include and exclude arrays
 */
export const loadTagFilters = () => {
  if (typeof window === 'undefined') return { ...DEFAULT_TAG_FILTER }
  try {
    const includeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_INCLUDE_KEY) || '[]')
    const excludeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_EXCLUDE_KEY) || '[]')
    const include = normalizeTagArray(includeRaw)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(excludeRaw).filter(tag => !includeSet.has(tag))
    return { include, exclude }
  } catch {
    return { ...DEFAULT_TAG_FILTER }
  }
}

/**
 * Save tag filters to localStorage
 * @param {Object} filters - Tag filter object with include and exclude arrays
 */
export const saveTagFilters = (filters) => {
  try {
    const include = normalizeTagArray(filters?.include)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(filters?.exclude).filter(tag => !includeSet.has(tag))
    localStorage.setItem(FILTER_TAG_INCLUDE_KEY, JSON.stringify(include))
    localStorage.setItem(FILTER_TAG_EXCLUDE_KEY, JSON.stringify(exclude))
  } catch {}
}

