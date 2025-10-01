import { DOMAIN_LIKE_RE, URL_PROTOCOL_RE } from './constants.js'

// ============================================================================
// URL Utilities
// Helper functions for URL detection, normalization, and regex escaping
// ============================================================================

/**
 * Checks if a string appears to be a URL
 * @param {string} [value=''] - The string to check
 * @returns {boolean} True if the string looks like a URL
 */
export function isLikelyUrl(value = '') {
  const trimmed = value.trim()
  if (!trimmed) return false

  // Check if it has a protocol
  if (URL_PROTOCOL_RE.test(trimmed)) {
    try {
      new URL(trimmed)
      return true
    } catch {
      return false
    }
  }

  // Check if it looks like a domain
  return DOMAIN_LIKE_RE.test(trimmed)
}

/**
 * Normalizes a URL by adding https:// protocol if missing
 * @param {string} [value=''] - The URL string to normalize
 * @returns {string} The normalized URL with protocol
 */
export function normalizeUrl(value = '') {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (URL_PROTOCOL_RE.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/**
 * Escapes special regex characters in a string
 * @param {string} [value=''] - The string to escape
 * @returns {string} The escaped string safe for use in RegExp
 */
export function escapeForRegex(value = '') {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}
