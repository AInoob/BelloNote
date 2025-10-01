import { COLLAPSED_KEY } from './constants.js'

// ============================================================================
// Collapsed State Management
// Manages which outline nodes are collapsed/expanded, with localStorage persistence
// ============================================================================

/**
 * In-memory cache of collapsed node IDs for each focus context
 * @type {Map<string, string[]>}
 */
export const COLLAPSED_CACHE = new Map()

/**
 * Generates the storage key for a given focus root
 * @param {string|null} focusRootId - The focused root node ID, or null for global
 * @returns {string} The localStorage key
 */
export const collapsedStorageKey = (focusRootId) =>
  focusRootId ? `${COLLAPSED_KEY}.${focusRootId}` : COLLAPSED_KEY

/**
 * Loads the set of collapsed node IDs for a given focus root
 * Uses cache to avoid repeated localStorage reads
 * @param {string|null} focusRootId - The focused root node ID, or null for global
 * @returns {Set<string>} Set of collapsed node IDs
 */
export function loadCollapsedSetForRoot(focusRootId) {
  if (typeof window === 'undefined') return new Set()

  const key = collapsedStorageKey(focusRootId)

  if (!COLLAPSED_CACHE.has(key)) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(key) || '[]')
      if (Array.isArray(raw)) {
        COLLAPSED_CACHE.set(key, raw.map(String))
      } else {
        COLLAPSED_CACHE.set(key, [])
      }
    } catch {
      COLLAPSED_CACHE.set(key, [])
    }
  }

  return new Set(COLLAPSED_CACHE.get(key) || [])
}

/**
 * Saves the set of collapsed node IDs for a given focus root
 * Updates both cache and localStorage
 * @param {string|null} focusRootId - The focused root node ID, or null for global
 * @param {Set<string>} set - Set of collapsed node IDs to save
 */
export function saveCollapsedSetForRoot(focusRootId, set) {
  if (typeof window === 'undefined') return

  const key = collapsedStorageKey(focusRootId)
  const arr = Array.from(set || []).map(String)

  COLLAPSED_CACHE.set(key, arr)

  try {
    window.localStorage.setItem(key, JSON.stringify(arr))
  } catch {
    // Ignore localStorage errors
  }
}
