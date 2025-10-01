/**
 * Formats a timestamp into a localized string
 * @param {string|Date} stamp - The timestamp to format (string or Date object)
 * @returns {string} Formatted timestamp or 'unknown' if invalid
 */
export function formatTimestamp(stamp) {
  if (!stamp) return 'unknown'

  const date = typeof stamp === 'string' ? new Date(stamp) : stamp

  if (!date || Number.isNaN(date.valueOf())) {
    return String(stamp)
  }

  return date.toLocaleString()
}
