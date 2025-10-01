// ============================================================================
// Focus Mode Collapsed State Storage
// Manages localStorage persistence of collapsed state per focus root
// ============================================================================

const COLLAPSED_KEY = 'worklog.collapsed'
const COLLAPSED_CACHE = new Map()

/**
 * Gets the storage key for a specific focus root
 * @param {string|null} focusRootId - Focus root ID
 * @returns {string} Storage key
 */
export const collapsedStorageKey = (focusRootId) =>
  focusRootId ? `${COLLAPSED_KEY}.${focusRootId}` : COLLAPSED_KEY

/**
 * Loads collapsed set from localStorage for a given focus root
 * @param {string|null} focusRootId - Focus root ID
 * @returns {Set<string>} Set of collapsed item IDs
 */
export const loadCollapsedSetForRoot = (focusRootId) => {
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
 * Saves collapsed set to localStorage for a given focus root
 * @param {string|null} focusRootId - Focus root ID
 * @param {Set<string>} set - Set of collapsed item IDs
 */
export const saveCollapsedSetForRoot = (focusRootId, set) => {
  if (typeof window === 'undefined') return
  const key = collapsedStorageKey(focusRootId)
  const arr = Array.from(set || []).map(String)
  COLLAPSED_CACHE.set(key, arr)
  try {
    window.localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}
