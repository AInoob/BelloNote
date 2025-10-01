// ============================================================================
// Reminder Outline Builder
// Constructs outline trees from reminder data for display in RemindersView
// ============================================================================

import { computeReminderDisplay } from './reminderTokens.js'
import { cloneOutlineNodes } from './outline.js'
import { formatReminderAbsolute } from './reminders.js'

/**
 * Builds outline root nodes from reminder data
 * Each reminder becomes a root node with its original content and children
 * Appends reminder summary info as an additional paragraph
 * @param {Array} reminders - Array of reminder objects
 * @param {Map} outlineMap - Map of task IDs to outline nodes
 * @returns {Array} Array of outline root nodes for rendering
 */
export function buildReminderOutlineRoots(reminders, outlineMap) {
  return reminders.map((reminder) => {
    // Build reminder summary info text
    const infoParts = []
    const display = computeReminderDisplay(reminder)
    if (display.summary) infoParts.push(display.summary)
    const absolute = formatReminderAbsolute(reminder)
    if (absolute) infoParts.push(absolute)
    const infoText = infoParts.join(' • ')

    // Get base node from outline if available
    const baseNode = outlineMap?.get(String(reminder.taskId))
    const titleText = reminder.taskTitle || `Task #${reminder.taskId}`

    // Use base node content or create default paragraph
    const content = baseNode && Array.isArray(baseNode.content)
      ? cloneOutlineNodes(baseNode.content)
      : [{ type: 'paragraph', content: [{ type: 'text', text: titleText }] }]

    // Append reminder info paragraph if available
    if (infoText) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: infoText, attrs: { 'data-reminder-summary': '1' } }]
      })
    }

    // Build result node with task data
    const result = {
      id: reminder.taskId,
      title: titleText,
      status: reminder.taskStatus ?? '',
      content,
      children: []
    }

    // Copy children from base node if available
    if (baseNode && Array.isArray(baseNode.children)) {
      result.children = cloneOutlineNodes(baseNode.children)
    }

    return result
  })
}
