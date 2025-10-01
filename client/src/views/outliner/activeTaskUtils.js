import dayjs from 'dayjs'
import { parseReminderTokenFromText } from '../../utils/reminderTokens.js'

/**
 * Compute information about the currently active task (task at cursor position)
 * @param {Object} editor - TipTap editor instance
 * @returns {Object|null} Active task information or null
 */
export function computeActiveTask(editor) {
  if (!editor) return null
  try {
    const { state } = editor
    if (!state) return null
    const { $from } = state.selection
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth)
      if (!node || node.type?.name !== 'listItem') continue
      const dataId = node.attrs?.dataId ? String(node.attrs.dataId) : null
      const reminder = parseReminderTokenFromText(node.textContent || '')
      const textContent = node.textContent || ''
      const dateMatches = textContent.match(/@\d{4}-\d{2}-\d{2}/g) || []
      const dates = Array.from(new Set(dateMatches.map(item => item.slice(1))))
      const hasDate = dates.length > 0
      const hasReminder = !!reminder
      const reminderDate = reminder?.remindAt ? dayjs(reminder.remindAt).format('YYYY-MM-DD') : null
      return {
        id: dataId,
        hasReminder,
        hasDate,
        dates,
        reminderDate,
        remindAt: reminder?.remindAt || null
      }
    }
  } catch {
    return null
  }
  return null
}

