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

export const DEFAULT_STATUS_FILTER = {
  none: true,
  todo: true,
  'in-progress': true,
  done: true
}

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

export function saveStatusFilter(filter) {
  try {
    localStorage.setItem(
      FILTER_STATUS_KEY,
      JSON.stringify({ ...DEFAULT_STATUS_FILTER, ...(filter || {}) })
    )
  } catch {}
}

export function loadArchivedVisible() {
  try {
    const value = localStorage.getItem(FILTER_ARCHIVED_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

export function saveArchivedVisible(value) {
  try {
    localStorage.setItem(FILTER_ARCHIVED_KEY, value ? '1' : '0')
  } catch {}
}

export function loadFutureVisible() {
  try {
    const value = localStorage.getItem(FILTER_FUTURE_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

export function saveFutureVisible(value) {
  try {
    localStorage.setItem(FILTER_FUTURE_KEY, value ? '1' : '0')
  } catch {}
}

export function loadSoonVisible() {
  try {
    const value = localStorage.getItem(FILTER_SOON_KEY)
    return value === '0' ? false : true
  } catch {
    return true
  }
}

export function saveSoonVisible(value) {
  try {
    localStorage.setItem(FILTER_SOON_KEY, value ? '1' : '0')
  } catch {}
}

export const DEFAULT_TAG_FILTER = { include: [], exclude: [] }

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

export function loadTagFilters() {
  if (typeof window === 'undefined') return { ...DEFAULT_TAG_FILTER }
  try {
    const includeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_INCLUDE_KEY) || '[]')
    const excludeRaw = JSON.parse(localStorage.getItem(FILTER_TAG_EXCLUDE_KEY) || '[]')
    const include = normalizeTagArray(includeRaw)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(excludeRaw).filter((tag) => !includeSet.has(tag))
    return { include, exclude }
  } catch {
    return { ...DEFAULT_TAG_FILTER }
  }
}

export function saveTagFilters(filters) {
  try {
    const include = normalizeTagArray(filters?.include)
    const includeSet = new Set(include)
    const exclude = normalizeTagArray(filters?.exclude).filter((tag) => !includeSet.has(tag))
    localStorage.setItem(FILTER_TAG_INCLUDE_KEY, JSON.stringify(include))
    localStorage.setItem(FILTER_TAG_EXCLUDE_KEY, JSON.stringify(exclude))
  } catch {}
}

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
