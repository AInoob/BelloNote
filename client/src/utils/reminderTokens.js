import dayjs from 'dayjs'

export const REMINDER_DISPLAY_BREAK = '\u200B'
const REMINDER_CANONICAL_PREFIX = '[[reminder'
const REMINDER_DISPLAY_PREFIX = `[[${REMINDER_DISPLAY_BREAK}reminder`
const REMINDER_ANY_PREFIX_RE = new RegExp(`\\[\\[(?:${REMINDER_DISPLAY_BREAK})?reminder(?=\\|)`, 'gi')
const REMINDER_DISPLAY_PREFIX_RE = new RegExp(`\\[\\[${REMINDER_DISPLAY_BREAK}reminder(?=\\|)`, 'gi')

export const REMINDER_TOKEN_REGEX = new RegExp(`\\[\\[(?:${REMINDER_DISPLAY_BREAK})?reminder\\|([^|]*)\\|([^|]*?)(?:\\|([^\\]]*))?\\]\]`, 'i')
const REMINDER_TOKEN_CANONICAL_REGEX = /\[\[reminder\|([^|]*)\|([^|]*?)(?:\|([^\]]*))?\]\]/i

export const encodeReminderDisplayTokens = (text = '') => {
  if (typeof text !== 'string' || !text) return text
  return text.replace(REMINDER_ANY_PREFIX_RE, REMINDER_DISPLAY_PREFIX)
}

export const decodeReminderDisplayTokens = (text = '') => {
  if (typeof text !== 'string' || !text) return text
  return text.replace(REMINDER_DISPLAY_PREFIX_RE, REMINDER_CANONICAL_PREFIX)
}

const encodeFragment = (value = '') => encodeURIComponent(value)
const decodeFragment = (value = '') => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function buildReminderToken({ status = 'incomplete', remindAt = '', message = '' } = {}) {
  const parts = ['reminder', status || '', remindAt || '']
  const encodedMessage = message ? encodeFragment(message) : ''
  if (encodedMessage) parts.push(encodedMessage)
  return `[[${parts.join('|')}]]`
}

export function describeTimeUntil(reminder) {
  if (!reminder?.remindAt) return ''
  const target = dayjs(reminder.remindAt)
  if (!target.isValid()) return ''
  const now = dayjs()
  const diffMinutes = target.diff(now, 'minute')
  if (diffMinutes <= 0) {
    const ago = Math.abs(diffMinutes)
    if (ago < 1) return 'due now'
    if (ago < 60) return `${ago}m overdue`
    const hours = Math.round(ago / 60)
    if (hours < 24) return `${hours}h overdue`
    const days = Math.round(hours / 24)
    return `${days}d overdue`
  }
  if (diffMinutes < 60) return `in ${diffMinutes}m`
  const hours = Math.round(diffMinutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}

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
    message: rawMessage ? decodeFragment(rawMessage) : '',
  }
}

export function removeReminderTokenFromText(text = '') {
  if (typeof text !== 'string') return text
  return decodeReminderDisplayTokens(text.replace(REMINDER_TOKEN_REGEX, '')).replace(/\s{2,}/g, ' ').trim()
}

export function upsertReminderTokenInText(text = '', token) {
  if (!token) return removeReminderTokenFromText(text)
  const displayToken = encodeReminderDisplayTokens(token)
  if (REMINDER_TOKEN_REGEX.test(text)) {
    return text.replace(REMINDER_TOKEN_REGEX, displayToken)
  }
  const trimmed = text.trim()
  return trimmed ? `${trimmed} ${displayToken}` : displayToken
}

export function reminderIsDue(reminder) {
  if (!reminder || reminder.status !== 'incomplete') return false
  if (!reminder.remindAt) return false
  const target = dayjs(reminder.remindAt)
  if (!target.isValid?.()) return false
  return target.isBefore(dayjs())
}

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

export function parseReminderFromNodeContent(content = []) {
  let nodes = content
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

export function stripReminderDisplayBreaks(text = '') {
  return decodeReminderDisplayTokens(text)
}

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
