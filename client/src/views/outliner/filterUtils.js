// ============================================================================
// Filter Utilities
// Storage and filter management helpers for status, tags, and visibility
// ============================================================================

import React from 'react'
import { parseTagInput } from './tagUtils.js'
import { stripReminderDisplayBreaks } from '../../utils/reminderTokens.js'

// Storage keys
const COLLAPSED_KEY = 'worklog.collapsed'
const FILTER_STATUS_KEY = 'worklog.filter.status'
const FILTER_ARCHIVED_KEY = 'worklog.filter.archived'
const FILTER_FUTURE_KEY = 'worklog.filter.future'
const FILTER_SOON_KEY = 'worklog.filter.soon'
const FILTER_TAG_INCLUDE_KEY = 'worklog.filter.tags.include'
const FILTER_TAG_EXCLUDE_KEY = 'worklog.filter.tags.exclude'
const SCROLL_STATE_KEY = 'worklog.lastScroll'

export const LOG_ON = () => (localStorage.getItem('WL_DEBUG') === '1')
export const LOG = (...args) => { if (LOG_ON()) console.log('[slash]', ...args) }

const COLLAPSED_CACHE = new Map()

export const collapsedStorageKey = (focusRootId) => focusRootId ? `${COLLAPSED_KEY}.${focusRootId}` : COLLAPSED_KEY

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

export const saveCollapsedSetForRoot = (focusRootId, set) => {
  if (typeof window === 'undefined') return
  const key = collapsedStorageKey(focusRootId)
  const arr = Array.from(set || []).map(String)
  COLLAPSED_CACHE.set(key, arr)
  try {
    window.localStorage.setItem(key, JSON.stringify(arr))
  } catch {}
}

export const focusContextDefaults = {
  focusRootId: null,
  requestFocus: () => {},
  exitFocus: () => {},
  loadCollapsedSet: loadCollapsedSetForRoot,
  saveCollapsedSet: saveCollapsedSetForRoot,
  forceExpand: false
}

export const FocusContext = React.createContext(focusContextDefaults)

export const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\-_]/g, (match) => `\\${match}`)
}

export const gatherOwnListItemText = (listItemNode) => {
  if (!listItemNode || listItemNode.type?.name !== 'listItem') return ''
  const parts = []
  const visit = (pmNode) => {
    if (!pmNode) return
    const typeName = pmNode.type?.name
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    if (pmNode.isText && pmNode.text) {
      parts.push(pmNode.text)
      return
    }
    if (typeof pmNode.forEach === 'function') {
      pmNode.forEach(child => visit(child))
    }
  }
  listItemNode.forEach(child => {
    const typeName = child.type?.name
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    visit(child)
  })
  return stripReminderDisplayBreaks(parts.join(' '))
}

export const DEFAULT_STATUS_FILTER = { none: true, todo: true, 'in-progress': true, done: true }

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

export const saveStatusFilter = (f) => {
  try { localStorage.setItem(FILTER_STATUS_KEY, JSON.stringify({ ...DEFAULT_STATUS_FILTER, ...(f||{}) })) } catch {}
}

export const loadArchivedVisible = () => {
  try { const v = localStorage.getItem(FILTER_ARCHIVED_KEY); return v === '0' ? false : true } catch { return true }
}

export const saveArchivedVisible = (v) => { try { localStorage.setItem(FILTER_ARCHIVED_KEY, v ? '1' : '0') } catch {} }

export const loadFutureVisible = () => { try { const v = localStorage.getItem(FILTER_FUTURE_KEY); return v === '0' ? false : true } catch { return true } }

export const saveFutureVisible = (v) => { try { localStorage.setItem(FILTER_FUTURE_KEY, v ? '1' : '0') } catch {} }

export const loadSoonVisible = () => { try { const v = localStorage.getItem(FILTER_SOON_KEY); return v === '0' ? false : true } catch { return true } }

export const saveSoonVisible = (v) => { try { localStorage.setItem(FILTER_SOON_KEY, v ? '1' : '0') } catch {} }

export const DEFAULT_TAG_FILTER = { include: [], exclude: [] }

const normalizeTagArray = (input) => {
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

export const saveTagFilters = (filters) => {
  try {
    const include = normalizeTagArray(filters?.include)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(filters?.exclude).filter(tag => !includeSet.has(tag))
    localStorage.setItem(FILTER_TAG_INCLUDE_KEY, JSON.stringify(include))
    localStorage.setItem(FILTER_TAG_EXCLUDE_KEY, JSON.stringify(exclude))
  } catch {}
}

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

export const migrateCollapsedSets = (idMapping) => {
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

  entries.forEach(([oldIdRaw, newIdRaw]) => {
    const oldId = normalize(oldIdRaw)
    const newId = normalize(newIdRaw)
    const oldKey = collapsedStorageKey(oldId)
    const newKey = collapsedStorageKey(newId)
    if (COLLAPSED_CACHE.has(oldKey)) {
      const cached = COLLAPSED_CACHE.get(oldKey) || []
      writeCacheAndStorage(newKey, replaceInArray(cached))
      COLLAPSED_CACHE.delete(oldKey)
    }
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

  const cacheKeys = Array.from(COLLAPSED_CACHE.keys())
  cacheKeys.forEach((key) => {
    const current = COLLAPSED_CACHE.get(key) || []
    const updated = replaceInArray(current)
    let changed = updated.length !== current.length
    if (!changed) {
      for (let i = 0; i < updated.length; i += 1) {
        if (updated[i] !== current[i]) { changed = true; break }
      }
    }
    if (changed) writeCacheAndStorage(key, updated)
  })

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
            if (updated[i] !== parsed[i]) { changed = true; break }
          }
        }
        if (changed) window.localStorage.setItem(key, JSON.stringify(updated))
      } catch {}
    })
  }
}
