/**
 * LocalStorage utilities for Timeline view preferences
 */

import { TIMELINE_FILTERS_KEY } from './constants.js'

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
