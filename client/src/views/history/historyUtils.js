// ============================================================================
// History Utility Functions
// Helper functions for history/version management
// ============================================================================

/** Milliseconds in a day */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parses a timestamp string to a Date object
 * @param {string} ts - Timestamp string (assumes UTC if no Z suffix)
 * @returns {Date|null} Parsed date or null if invalid
 */
export function parseTimestamp(ts) {
  try {
    const date = new Date(ts + 'Z')
    return Number.isNaN(date.valueOf()) ? null : date
  } catch {
    return null
  }
}

/**
 * Returns the start of day for a given date
 * @param {Date} date - Date to process
 * @returns {Date} Date at 00:00:00.000
 */
export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Formats a date as a human-readable day label
 * @param {Date} date - Date to format
 * @returns {string} Day label (e.g., "Today", "Yesterday", "Mon, Jan 15")
 */
export function formatDayLabel(date) {
  const today = startOfDay(new Date())
  const target = startOfDay(date)
  const diffDays = Math.round((today.getTime() - target.getTime()) / DAY_MS)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  if (today.getFullYear() !== target.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString(undefined, opts)
}

/**
 * Formats a timestamp as time only
 * @param {string} ts - Timestamp string
 * @returns {string} Formatted time or original string if invalid
 */
export function formatTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ts
}

/**
 * Formats a timestamp for version metadata display
 * @param {string} ts - Timestamp string
 * @returns {string} Formatted time or empty string if invalid
 */
export function formatVersionTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Formats byte size for display
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "512 B", "15 KB")
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * Builds metadata text for a version item
 * @param {Object} it - Version item with created_at and size_bytes
 * @returns {string} Formatted metadata text
 */
export function versionMetaText(it) {
  const time = formatVersionTime(it.created_at)
  const size = formatSize(it.size_bytes)
  return [time, size].filter(Boolean).join(' · ')
}

/**
 * Groups history items by day
 * @param {Array} rows - Array of history items with created_at timestamps
 * @returns {Array} Array of day groups with items sorted by time
 */
export function groupHistory(rows) {
  const byDay = new Map()
  rows.forEach(row => {
    const date = parseTimestamp(row.created_at)
    if (!date) return
    const dayKey = date.toISOString().slice(0, 10)
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, {
        key: dayKey,
        label: formatDayLabel(date),
        items: []
      })
    }
    byDay.get(dayKey).items.push(row)
  })
  const groups = Array.from(byDay.values())
  groups.forEach(group => {
    group.items.sort((a, b) => {
      const da = parseTimestamp(a.created_at)
      const db = parseTimestamp(b.created_at)
      return (db?.getTime() || 0) - (da?.getTime() || 0)
    })
  })
  groups.sort((a, b) => (a.key > b.key ? -1 : (a.key < b.key ? 1 : 0)))
  return groups
}
