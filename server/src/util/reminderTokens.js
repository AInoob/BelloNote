import { parseMaybeJson } from '../lib/richtext.js'

export const REMINDER_TOKEN_REGEX = /\[\[reminder\|([^|]*)\|([^|]*?)(?:\|([^\]]*))?\]\]/i

const decodeFragment = (value = '') => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseReminderFromNodes(nodes) {
  if (!Array.isArray(nodes)) return null
  for (const block of nodes) {
    if (!block || block.type !== 'paragraph' || !Array.isArray(block.content)) continue
    for (const child of block.content) {
      if (child?.type === 'text' && typeof child.text === 'string') {
        const match = REMINDER_TOKEN_REGEX.exec(child.text)
        if (match) {
          const [, statusRaw = '', remindAtRaw = '', messageRaw = ''] = match
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
