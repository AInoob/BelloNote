/**
 * Date and time formatting utilities for the History view
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parse a timestamp string into a Date object
 * Assumes the timestamp is in UTC and appends 'Z' if needed
 * 
 * @param {string} ts - Timestamp string
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
 * Get the start of day (midnight) for a given date
 * 
 * @param {Date} date - Input date
 * @returns {Date} Date set to midnight (00:00:00.000)
 */
export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Format a day label relative to today (e.g., "Today", "Yesterday", or date string)
 * 
 * @param {Date} date - Date to format
 * @returns {string} Formatted day label
 */
export function formatDayLabel(date) {
  const today = startOfDay(new Date())
  const target = startOfDay(date)
  const diffDays = Math.round((today.getTime() - target.getTime()) / DAY_MS)
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  if (today.getFullYear() !== target.getFullYear()) {
    opts.year = 'numeric'
  }
  
  return date.toLocaleDateString(undefined, opts)
}

/**
 * Format a timestamp as a time string (HH:MM)
 * 
 * @param {string} ts - Timestamp string
 * @returns {string} Formatted time or original timestamp if parsing fails
 */
export function formatTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ts
}

/**
 * Format a timestamp as a time string for version metadata
 * 
 * @param {string} ts - Timestamp string
 * @returns {string} Formatted time or empty string if parsing fails
 */
export function formatVersionTime(ts) {
  const date = parseTimestamp(ts)
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Format bytes as a human-readable size string
 * 
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted size (e.g., "1.5 KB")
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * Generate version metadata text (time and size)
 * 
 * @param {Object} it - Version item with created_at and size_bytes properties
 * @returns {string} Formatted metadata text
 */
export function versionMetaText(it) {
  const time = formatVersionTime(it.created_at)
  const size = formatSize(it.size_bytes)
  return [time, size].filter(Boolean).join(' · ')
}

