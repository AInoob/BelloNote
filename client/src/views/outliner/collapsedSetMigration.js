import { COLLAPSED_CACHE, collapsedStorageKey } from './collapsedState.js'
import { COLLAPSED_KEY } from './constants.js'

/**
 * Migrate collapsed sets when task IDs change (e.g., after saving new tasks)
 * Updates both in-memory cache and localStorage to use new IDs
 * 
 * @param {Object} idMapping - Map of old IDs to new IDs
 */
export function migrateCollapsedSets(idMapping) {
  if (!idMapping || typeof idMapping !== 'object') return
  const entries = Object.entries(idMapping)
  if (!entries.length) return
  
  const normalize = (value) => String(value ?? '')
  
  const replaceInArray = (arr) => arr.map(value => {
    const mapped = idMapping[normalize(value)]
    return mapped !== undefined ? normalize(mapped) : normalize(value)
  })
  
  const writeCacheAndStorage = (key, arrValues) => {
    const normalized = arrValues.map(normalize)
    COLLAPSED_CACHE.set(key, normalized)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, JSON.stringify(normalized))
      } catch {}
    }
  }

  // Migrate specific keys that match old IDs
  entries.forEach(([oldIdRaw, newIdRaw]) => {
    const oldId = normalize(oldIdRaw)
    const newId = normalize(newIdRaw)
    const oldKey = collapsedStorageKey(oldId)
    const newKey = collapsedStorageKey(newId)
    
    // Migrate from cache
    if (COLLAPSED_CACHE.has(oldKey)) {
      const cached = COLLAPSED_CACHE.get(oldKey) || []
      writeCacheAndStorage(newKey, replaceInArray(cached))
      COLLAPSED_CACHE.delete(oldKey)
    }
    
    // Migrate from localStorage
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(oldKey)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          const arr = Array.isArray(parsed) ? replaceInArray(parsed) : []
          window.localStorage.setItem(newKey, JSON.stringify(arr))
        }
        window.localStorage.removeItem(oldKey)
      } catch {}
    }
  })

  // Update all cached sets to replace any old IDs in their arrays
  const cacheKeys = Array.from(COLLAPSED_CACHE.keys())
  cacheKeys.forEach((key) => {
    const current = COLLAPSED_CACHE.get(key) || []
    const updated = replaceInArray(current)
    let changed = updated.length !== current.length
    if (!changed) {
      for (let i = 0; i < updated.length; i += 1) {
        if (updated[i] !== current[i]) { 
          changed = true
          break 
        }
      }
    }
    if (changed) writeCacheAndStorage(key, updated)
  })

  // Update all localStorage sets to replace any old IDs in their arrays
  if (typeof window !== 'undefined') {
    const keysToReview = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(COLLAPSED_KEY)) keysToReview.push(key)
    }
    keysToReview.forEach((key) => {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return
        const updated = replaceInArray(parsed)
        let changed = updated.length !== parsed.length
        if (!changed) {
          for (let i = 0; i < updated.length; i += 1) {
            if (updated[i] !== parsed[i]) { 
              changed = true
              break 
            }
          }
        }
        if (changed) window.localStorage.setItem(key, JSON.stringify(updated))
      } catch {}
    })
  }
}

