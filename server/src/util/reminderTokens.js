import { parseMaybeJson } from '../lib/richtext.js'

const REMINDER_DISPLAY_BREAK = '\u200B'
const REMINDER_TOKEN_REGEX = new RegExp(`\\[\\[(?:${REMINDER_DISPLAY_BREAK})?reminder\\|([^|]*)\\|([^|]*?)(?:\\|([^\\]]*))?\\]\]`, 'i')

const decodeFragment = (value = '') => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const stripDisplayBreak = (text = '') => text.replace(`[[${REMINDER_DISPLAY_BREAK}`, '[[reminder')

export function parseReminderFromNodes(nodes) {
  if (!Array.isArray(nodes)) return null
  for (const block of nodes) {
    if (!block || block.type !== 'paragraph' || !Array.isArray(block.content)) continue
    for (const child of block.content) {
      if (child?.type === 'text' && typeof child.text === 'string') {
        const match = REMINDER_TOKEN_REGEX.exec(child.text)
        if (match) {
          const normalized = stripDisplayBreak(match[0])
          const normalizedMatch = REMINDER_TOKEN_REGEX.exec(normalized) || match
          const [, statusRaw = '', remindAtRaw = '', messageRaw = ''] = normalizedMatch
          return {
            status: statusRaw || 'incomplete',
            remindAt: remindAtRaw || '',
            message: messageRaw ? decodeFragment(messageRaw) : ''
          }
        }
      }
    }
  }
  return null
}

export function parseReminderFromTask(task) {
  if (!task) return null
  let nodes = []
  try {
    nodes = parseMaybeJson(task.content || '[]')
  } catch {
    nodes = []
  }
  return parseReminderFromNodes(nodes)
}
