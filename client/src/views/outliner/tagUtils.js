// ============================================================================
// Tag Utilities
// Functions for parsing and extracting hashtags from text
// ============================================================================

import { TAG_SCAN_RE, TAG_VALUE_RE } from './constants.js'

/**
 * Parses user input into a normalized tag object
 * Accepts input with or without leading #, validates format
 * @param {string} [value=''] - User input (e.g., "#tag" or "tag")
 * @returns {Object|null} Tag object with canonical (lowercase) and display forms, or null if invalid
 */
export function parseTagInput(value = '') {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // Remove leading # if present
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed

  // Validate tag format (alphanumeric, dash, underscore; 1-64 chars)
  if (!TAG_VALUE_RE.test(withoutHash)) return null

  const canonical = withoutHash.toLowerCase()
  return { canonical, display: withoutHash }
}

/**
 * Extracts all hashtags from text
 * Returns unique tags (case-insensitive) with original casing preserved
 * @param {string} [text=''] - Text to scan for hashtags
 * @returns {Array<Object>} Array of tag objects with canonical and display forms
 */
export function extractTagsFromText(text = '') {
  if (typeof text !== 'string' || !text) return []

  const seen = new Map()
  TAG_SCAN_RE.lastIndex = 0

  let match
  while ((match = TAG_SCAN_RE.exec(text)) !== null) {
    const raw = match[2]
    if (!raw) continue

    // Use lowercase for deduplication, but preserve first occurrence's casing
    const canonical = raw.toLowerCase()
    if (!seen.has(canonical)) seen.set(canonical, raw)
  }

  return Array.from(seen, ([canonical, display]) => ({ canonical, display }))
}
