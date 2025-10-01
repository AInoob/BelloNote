import { SCROLL_STATE_KEY } from './constants.js'

/**
 * Load the saved scroll state from localStorage
 * @returns {Object|null} The scroll state object with scrollY property, or null if not found
 */
export const loadScrollState = () => {
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

/**
 * Save the scroll state to localStorage
 * @param {Object} payload - The scroll state payload
 * @param {number} payload.scrollY - The vertical scroll position
 * @param {number} [payload.selectionFrom] - The selection position (optional)
 * @param {number} [payload.timestamp] - The timestamp (optional)
 */
export const saveScrollState = (payload) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SCROLL_STATE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore errors
  }
}

