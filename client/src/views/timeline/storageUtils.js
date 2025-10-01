/**
 * LocalStorage utilities for Timeline view preferences
 */

import {
  TIMELINE_FUTURE_KEY,
  TIMELINE_SOON_KEY,
  TIMELINE_FILTERS_KEY
} from './constants.js'

/**
 * Load the "show future" preference from localStorage
 * @returns {boolean} Whether to show future items (defaults to true)
 */
export function loadShowFuture() {
  try {
    const v = localStorage.getItem(TIMELINE_FUTURE_KEY)
    return v === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Save the "show future" preference to localStorage
 * @param {boolean} value - Whether to show future items
 */
export function saveShowFuture(value) {
  try {
    localStorage.setItem(TIMELINE_FUTURE_KEY, value ? '1' : '0')
  } catch {}
}

/**
 * Load the "show soon" preference from localStorage
 * @returns {boolean} Whether to show soon items (defaults to true)
 */
export function loadShowSoon() {
  try {
    const v = localStorage.getItem(TIMELINE_SOON_KEY)
    return v === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Save the "show soon" preference to localStorage
 * @param {boolean} value - Whether to show soon items
 */
export function saveShowSoon(value) {
  try {
    localStorage.setItem(TIMELINE_SOON_KEY, value ? '1' : '0')
  } catch {}
}

/**
 * Load the "show filters" preference from localStorage
 * @returns {boolean} Whether to show the filter bar (defaults to true)
 */
export function loadShowFilters() {
  try {
    const v = localStorage.getItem(TIMELINE_FILTERS_KEY)
    return v === '0' ? false : true
  } catch {
    return true
  }
}

/**
 * Save the "show filters" preference to localStorage
 * @param {boolean} value - Whether to show the filter bar
 */
export function saveShowFilters(value) {
  try {
    localStorage.setItem(TIMELINE_FILTERS_KEY, value ? '1' : '0')
  } catch {}
}

