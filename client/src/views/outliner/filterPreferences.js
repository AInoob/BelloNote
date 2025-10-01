import {
  FILTER_ARCHIVED_KEY,
  FILTER_FUTURE_KEY,
  FILTER_SOON_KEY,
  FILTER_STATUS_KEY,
  FILTER_TAG_EXCLUDE_KEY,
  FILTER_TAG_INCLUDE_KEY,
  SCROLL_STATE_KEY
} from './constants.js'
import { parseTagInput } from './tagUtils.js'

// ============================================================================
// Filter Preferences Management
// Manages user filter preferences with localStorage persistence
// ============================================================================

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_STATUS_FILTER = {
  none: true,
  todo: true,
  'in-progress': true,
  done: true
}

export const DEFAULT_TAG_FILTER = {
  include: [],
  exclude: []
}

// ============================================================================
// Status Filter
// ============================================================================

/**
 * Loads status filter preferences from localStorage
 * @returns {Object} Filter object with boolean flags for each status
 */
export function loadStatusFilter() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_STATUS_KEY) || 'null')
    const obj = raw && typeof raw === 'object' ? raw : {}
    return {
      none: typeof obj.none === 'boolean' ? obj.none : true,
      todo: typeof obj.todo === 'boolean' ? obj.todo : true,
      'in-progress': typeof obj['in-progress'] === 'boolean' ? obj['in-progress'] : true,
      done: typeof obj.done === 'boolean' ? obj.done : true
    }
  } catch {
    return { ...DEFAULT_STATUS_FILTER }
  }
}

/**
 * Saves status filter preferences to localStorage
 * @param {Object} filter - Filter object with status visibility flags
 */
export function saveStatusFilter(filter) {
  try {
    localStorage.setItem(
      FILTER_STATUS_KEY,
      JSON.stringify({ ...DEFAULT_STATUS_FILTER, ...(filter || {}) })
    )
  } catch {
    // Ignore localStorage errors
  }
}

// ============================================================================
// Visibility Toggles
// ============================================================================

/**
 * Loads archived items visibility preference
 * @returns {boolean} True if archived items should be visible
 */
export function loadArchivedVisible() {
  try {
    const value = localStorage.getItem(FILTER_ARCHIVED_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Saves archived items visibility preference
 * @param {boolean} value - Whether archived items should be visible
 */
export function saveArchivedVisible(value) {
  try {
    localStorage.setItem(FILTER_ARCHIVED_KEY, value ? '1' : '0')
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Loads future items visibility preference
 * @returns {boolean} True if future items should be visible
 */
export function loadFutureVisible() {
  try {
    const value = localStorage.getItem(FILTER_FUTURE_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Saves future items visibility preference
 * @param {boolean} value - Whether future items should be visible
 */
export function saveFutureVisible(value) {
  try {
    localStorage.setItem(FILTER_FUTURE_KEY, value ? '1' : '0')
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Loads "soon" items visibility preference
 * @returns {boolean} True if "soon" items should be visible
 */
export function loadSoonVisible() {
  try {
    const value = localStorage.getItem(FILTER_SOON_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Saves "soon" items visibility preference
 * @param {boolean} value - Whether "soon" items should be visible
 */
export function saveSoonVisible(value) {
  try {
    localStorage.setItem(FILTER_SOON_KEY, value ? '1' : '0')
  } catch {
    // Ignore localStorage errors
  }
}

// ============================================================================
// Tag Filters
// ============================================================================

/**
 * Normalizes an array of tag strings into canonical form
 * @param {Array<string>} input - Array of tag strings
 * @returns {Array<string>} Sorted array of normalized tags
 */
function normalizeTagArray(input) {
  const set = new Set()
  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (typeof item !== 'string') return
      const parsed = parseTagInput(item)
      if (parsed) set.add(parsed.canonical)
    })
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/**
 * Loads tag filter preferences from localStorage
 * @returns {Object} Object with include and exclude tag arrays
 */
export function loadTagFilters() {
  if (typeof window === 'undefined') return { ...DEFAULT_TAG_FILTER }
  try {
    const includeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_INCLUDE_KEY) || '[]')
    const excludeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_EXCLUDE_KEY) || '[]')
    const include = normalizeTagArray(includeRaw)
    const includeSet = new Set(include)
    // Exclude tags that are in include set (no duplicates)
    const exclude = normalizeTagArray(excludeRaw).filter((tag) => !includeSet.has(tag))
    return { include, exclude }
  } catch {
    return { ...DEFAULT_TAG_FILTER }
  }
}

/**
 * Saves tag filter preferences to localStorage
 * @param {Object} filters - Object with include and exclude tag arrays
 */
export function saveTagFilters(filters) {
  try {
    const include = normalizeTagArray(filters?.include)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(filters?.exclude).filter((tag) => !includeSet.has(tag))
    localStorage.setItem(FILTER_TAG_INCLUDE_KEY, JSON.stringify(include))
    localStorage.setItem(FILTER_TAG_EXCLUDE_KEY, JSON.stringify(exclude))
  } catch {
    // Ignore localStorage errors
  }
}

// ============================================================================
// Scroll State
// ============================================================================

/**
 * Loads saved scroll position from localStorage
 * @returns {Object|null} Scroll state object with scrollY, or null if not found
 */
export function loadScrollState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SCROLL_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed.scrollY !== 'number') return null
    return parsed
  } catch {
    return null
  }
}
