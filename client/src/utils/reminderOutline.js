import { computeReminderDisplay } from './reminderTokens.js'
import { cloneOutlineNodes } from './outline.js'
import { formatReminderAbsolute } from './reminders.js'

export function buildReminderOutlineRoots(reminders, outlineMap) {
  return reminders.map((reminder) => {
    const infoParts = []
    const display = computeReminderDisplay(reminder)
    if (display.summary) infoParts.push(display.summary)
    const absolute = formatReminderAbsolute(reminder)
    if (absolute) infoParts.push(absolute)
    const infoText = infoParts.join(' • ')

    const baseNode = outlineMap?.get(String(reminder.taskId))
    const titleText = reminder.taskTitle || `Task #${reminder.taskId}`
    const content = baseNode && Array.isArray(baseNode.content)
      ? cloneOutlineNodes(baseNode.content)
      : [{ type: 'paragraph', content: [{ type: 'text', text: titleText }] }]

    if (infoText) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: infoText, attrs: { 'data-reminder-summary': '1' } }]
      })
    }

    const result = {
      id: reminder.taskId,
      title: titleText,
      status: reminder.taskStatus ?? '',
      content,
      children: []
    }

    if (baseNode && Array.isArray(baseNode.children)) {
      result.children = cloneOutlineNodes(baseNode.children)
    }

    return result
  })
}
