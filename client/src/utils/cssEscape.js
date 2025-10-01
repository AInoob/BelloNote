/**
 * Escape a string for use in CSS selectors
 * Uses native CSS.escape if available, otherwise falls back to manual escaping
 * 
 * @param {*} value - Value to escape
 * @returns {string} Escaped string safe for CSS selectors
 */
export function cssEscape(value) {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\-_]/g, (match) => `\\${match}`)
}

