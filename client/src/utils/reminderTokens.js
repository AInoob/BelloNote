import dayjs from 'dayjs'

// ============================================================================
// Reminder Token Utilities
// Handles parsing, encoding, and manipulation of reminder tokens in text
// Format: [[reminder|status|remindAt|message]]
// ============================================================================

// ============================================================================
// Constants
// ============================================================================

/**
 * Zero-width space character used to mark reminder tokens as "display only"
 * This prevents them from being edited directly in the UI
 */
export const REMINDER_DISPLAY_BREAK = '\u200B'

const REMINDER_CANONICAL_PREFIX = '[[reminder'
const REMINDER_DISPLAY_PREFIX = `[[${REMINDER_DISPLAY_BREAK}reminder`

const REMINDER_ANY_PREFIX_RE = new RegExp(`\\[\\[(?:${REMINDER_DISPLAY_BREAK})?reminder(?=\\|)`, 'gi')
const REMINDER_DISPLAY_PREFIX_RE = new RegExp(`\\[\\[${REMINDER_DISPLAY_BREAK}reminder(?=\\|)`, 'gi')

/**
 * Regex to match reminder tokens (both canonical and display forms)
 * Captures: status, remindAt, and optional message
 */
export const REMINDER_TOKEN_REGEX = new RegExp(
  `\\[\\[(?:${REMINDER_DISPLAY_BREAK})?reminder\\|([^|]*)\\|([^|]*?)(?:\\|([^\\]]*))?\\]\]`,
  'i'
)

const REMINDER_TOKEN_CANONICAL_REGEX = /\[\[reminder\|([^|]*)\|([^|]*?)(?:\|([^\]]*))?\]\]/i

// ============================================================================
// Encoding/Decoding
// ============================================================================

/**
 * Encodes reminder tokens to display form (with zero-width space)
 * @param {string} [text=''] - Text containing reminder tokens
 * @returns {string} Text with encoded reminder tokens
 */
export const encodeReminderDisplayTokens = (text = '') => {
  if (typeof text !== 'string' || !text) return text
  return text.replace(REMINDER_ANY_PREFIX_RE, REMINDER_DISPLAY_PREFIX)
}

/**
 * Decodes reminder tokens from display form to canonical form
 * @param {string} [text=''] - Text containing display reminder tokens
 * @returns {string} Text with canonical reminder tokens
 */
export const decodeReminderDisplayTokens = (text = '') => {
  if (typeof text !== 'string' || !text) return text
  return text.replace(REMINDER_DISPLAY_PREFIX_RE, REMINDER_CANONICAL_PREFIX)
}

/**
 * Encodes a string fragment for use in reminder token
 * @param {string} [value=''] - Value to encode
 * @returns {string} URL-encoded value
 */
const encodeFragment = (value = '') => encodeURIComponent(value)

/**
 * Decodes a string fragment from reminder token
 * @param {string} [value=''] - Value to decode
 * @returns {string} Decoded value or original if decoding fails
 */
const decodeFragment = (value = '') => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// ============================================================================
// Token Building and Parsing
// ============================================================================

/**
 * Builds a reminder token string from components
 * @param {Object} params - Reminder parameters
 * @param {string} [params.status='incomplete'] - Reminder status
 * @param {string} [params.remindAt=''] - ISO date string for reminder time
 * @param {string} [params.message=''] - Optional reminder message
 * @returns {string} Formatted reminder token
 */
export function buildReminderToken({ status = 'incomplete', remindAt = '', message = '' } = {}) {
  const parts = ['reminder', status || '', remindAt || '']
  const encodedMessage = message ? encodeFragment(message) : ''
  if (encodedMessage) parts.push(encodedMessage)
  return `[[${parts.join('|')}]]`
}

/**
 * Describes the time until/since a reminder in human-readable format
 * @param {Object} reminder - Reminder object
 * @param {string} [reminder.remindAt] - ISO date string
 * @returns {string} Human-readable time description (e.g., "in 5m", "2h overdue")
 */
export function describeTimeUntil(reminder) {
  if (!reminder?.remindAt) return ''
  const target = dayjs(reminder.remindAt)
  if (!target.isValid()) return ''

  const now = dayjs()
  const diffMinutes = target.diff(now, 'minute')

  // Overdue
  if (diffMinutes <= 0) {
    const ago = Math.abs(diffMinutes)
    if (ago < 1) return 'due now'
    if (ago < 60) return `${ago}m overdue`
    const hours = Math.round(ago / 60)
    if (hours < 24) return `${hours}h overdue`
    const days = Math.round(hours / 24)
    return `${days}d overdue`
  }

  // Upcoming
  if (diffMinutes < 60) return `in ${diffMinutes}m`
  const hours = Math.round(diffMinutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}

/**
 * Parses a reminder token from text
 * @param {string} [text=''] - Text containing a reminder token
 * @returns {Object|null} Parsed reminder with token, status, remindAt, message, or null
 */
export function parseReminderTokenFromText(text = '') {
  if (typeof text !== 'string') return null
  const match = REMINDER_TOKEN_REGEX.exec(text)
  if (!match) return null

  const canonical = decodeReminderDisplayTokens(match[0])
  const canonicalMatch = REMINDER_TOKEN_CANONICAL_REGEX.exec(canonical)
  if (!canonicalMatch) return null

  const [, rawStatus = '', rawRemindAt = '', rawMessage = ''] = canonicalMatch
  const remindAt = rawRemindAt || ''

  return {
    token: canonical,
    status: rawStatus || 'incomplete',
    remindAt,
    message: rawMessage ? decodeFragment(rawMessage) : ''
  }
}

/**
 * Removes reminder token from text
 * @param {string} [text=''] - Text containing reminder token
 * @returns {string} Text with reminder token removed
 */
export function removeReminderTokenFromText(text = '') {
  if (typeof text !== 'string') return text
  return decodeReminderDisplayTokens(text.replace(REMINDER_TOKEN_REGEX, ''))
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Upserts (updates or inserts) a reminder token in text
 * @param {string} [text=''] - Text to modify
 * @param {string} token - Reminder token to insert/update
 * @returns {string} Modified text
 */
export function upsertReminderTokenInText(text = '', token) {
  if (!token) return removeReminderTokenFromText(text)

  const displayToken = encodeReminderDisplayTokens(token)

  // Replace existing token
  if (REMINDER_TOKEN_REGEX.test(text)) {
    return text.replace(REMINDER_TOKEN_REGEX, displayToken)
  }

  // Append new token
  const trimmed = text.trim()
  return trimmed ? `${trimmed} ${displayToken}` : displayToken
}

// ============================================================================
// Status Checking
// ============================================================================

/**
 * Checks if a reminder is due (past its reminder time)
 * @param {Object} reminder - Reminder object
 * @param {string} [reminder.status] - Reminder status
 * @param {string} [reminder.remindAt] - ISO date string
 * @returns {boolean} True if reminder is due
 */
export function reminderIsDue(reminder) {
  if (!reminder || reminder.status !== 'incomplete') return false
  if (!reminder.remindAt) return false

  const target = dayjs(reminder.remindAt)
  if (!target.isValid?.()) return false

  return target.isBefore(dayjs())
}

// ============================================================================
// Display Computation
// ============================================================================

/**
 * Computes display strings for a reminder
 * @param {Object} reminder - Reminder object
 * @returns {Object} Display info with status, remindAt, due, summary, inlineLabel, pillText
 */
export function computeReminderDisplay(reminder) {
  if (!reminder) {
    return {
      status: '',
      remindAt: '',
      due: false,
      summary: '',
      inlineLabel: '',
      pillText: ''
    }
  }

  const status = reminder?.status || 'incomplete'
  const remindAt = reminder?.remindAt || ''
  const due = reminderIsDue(reminder)

  let summary = 'Reminder scheduled'
  let inlineLabel = 'Reminder'
  let pillText = 'Scheduled'

  if (status === 'completed') {
    summary = 'Reminder completed'
    inlineLabel = summary
    pillText = 'Completed'
  } else if (status === 'dismissed') {
    summary = 'Reminder dismissed'
    inlineLabel = summary
    pillText = 'Dismissed'
  } else if (status === 'incomplete') {
    if (due) {
      summary = 'Reminder due'
      inlineLabel = summary
      pillText = 'Due soon'
    } else if (remindAt) {
      const relative = describeTimeUntil(reminder)
      if (relative) {
        summary = `Reminds ${relative}`
        inlineLabel = summary
        pillText = relative
      }
    }
  }

  return {
    status,
    remindAt,
    due,
    summary,
    inlineLabel,
    pillText
  }
}

// ============================================================================
// Node Content Parsing
// ============================================================================

/**
 * Parses a reminder from ProseMirror node content
 * @param {Array|string} [content=[]] - Node content array or JSON string
 * @returns {Object|null} Parsed reminder or null if not found
 */
export function parseReminderFromNodeContent(content = []) {
  let nodes = content

  // Handle string input (JSON)
  if (!Array.isArray(nodes)) {
    if (typeof nodes === 'string') {
      try {
        const parsed = JSON.parse(nodes)
        if (Array.isArray(parsed)) nodes = parsed
        else return null
      } catch {
        return null
      }
    } else {
      return null
    }
  }

  // Search for reminder token in paragraph text nodes
  for (const block of nodes) {
    if (!block || block.type !== 'paragraph' || !Array.isArray(block.content)) continue
    for (const child of block.content) {
      if (child?.type === 'text' && typeof child.text === 'string') {
        const parsed = parseReminderTokenFromText(child.text)
        if (parsed) return parsed
      }
    }
  }

  return null
}

/**
 * Strips reminder display breaks from text
 * @param {string} [text=''] - Text to process
 * @returns {string} Text with display breaks removed
 */
export function stripReminderDisplayBreaks(text = '') {
  return decodeReminderDisplayTokens(text)
}

// ============================================================================
// JSON Normalization
// ============================================================================

/**
 * Recursively normalizes reminder tokens in JSON structure
 * Converts display tokens back to canonical form
 * @param {*} node - JSON node to normalize
 * @returns {*} Normalized node
 */
export function normalizeReminderTokensInJson(node) {
  if (node == null) return node

  if (Array.isArray(node)) {
    return node.map(child => normalizeReminderTokensInJson(child))
  }

  if (typeof node !== 'object') return node

  const result = { ...node }

  if (typeof result.text === 'string') {
    result.text = stripReminderDisplayBreaks(result.text)
  }

  if (Array.isArray(result.content)) {
    result.content = result.content.map(child => normalizeReminderTokensInJson(child))
  }

  if (Array.isArray(result.marks)) {
    result.marks = result.marks.map(mark => normalizeReminderTokensInJson(mark))
  }

  return result
}
