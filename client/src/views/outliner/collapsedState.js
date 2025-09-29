import { COLLAPSED_KEY } from './constants.js'

export const COLLAPSED_CACHE = new Map()

export const collapsedStorageKey = (focusRootId) =>
  focusRootId ? `${COLLAPSED_KEY}.${focusRootId}` : COLLAPSED_KEY

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

export function saveCollapsedSetForRoot(focusRootId, set) {
  if (typeof window === 'undefined') return
  const key = collapsedStorageKey(focusRootId)
  const arr = Array.from(set || []).map(String)
  COLLAPSED_CACHE.set(key, arr)
  try {
    window.localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}
