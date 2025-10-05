import { SCROLL_STATE_KEY } from './constants.js'

const SCROLL_STATE_VERSION = 2

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const version = Number(parsed.version)
  if (version !== SCROLL_STATE_VERSION) return null
  const topTaskId = typeof parsed.topTaskId === 'string' && parsed.topTaskId.trim() !== ''
    ? parsed.topTaskId
    : null
  const topTaskOffset = Number.isFinite(parsed.topTaskOffset)
    ? parsed.topTaskOffset
    : null
  const selectionFrom = Number.isFinite(parsed.selectionFrom)
    ? parsed.selectionFrom
    : null
  const timestamp = Number.isFinite(parsed.timestamp) ? parsed.timestamp : null
  const scrollY = Number.isFinite(parsed.scrollY) ? parsed.scrollY : null
  const normalized = {
    version: SCROLL_STATE_VERSION,
    topTaskId,
    topTaskOffset,
    selectionFrom,
    timestamp,
    scrollY
  }
  return normalized
}

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
    const normalized = normalizeState(parsed)
    if (!normalized) return null
    return normalized
  } catch (err) {
    return null
  }
}

/**
 * Save the scroll state to localStorage
 * @param {Object} payload - The scroll state payload
 * @param {string|null} payload.topTaskId - ID of the top-most visible task
 * @param {number|null} payload.topTaskOffset - Viewport offset (px) for the top task
 * @param {number} [payload.scrollY] - Snapshot of the vertical scroll position (debug only)
 * @param {number} [payload.selectionFrom] - The selection position (optional)
 * @param {number} [payload.timestamp] - The timestamp (optional)
 */
export const saveScrollState = (payload) => {
  if (typeof window === 'undefined') return
  try {
    const toStore = { version: SCROLL_STATE_VERSION, ...payload }
    localStorage.setItem(SCROLL_STATE_KEY, JSON.stringify(toStore))
  } catch {
    /* ignore persistence errors */
  }
}
