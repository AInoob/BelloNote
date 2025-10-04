/* eslint-disable no-restricted-globals */
import { parseReminderFromNodeContent, reminderIsDue } from '../utils/reminderTokens.js'

function buildReminderEntry(node, parsed) {
  if (!parsed) return null
  const id = node?.id != null ? String(node.id) : null
  if (!id) return null
  return {
    id,
    taskId: id,
    taskTitle: node?.title || '',
    taskStatus: node?.status || '',
    status: parsed.status || 'incomplete',
    remindAt: parsed.remindAt || '',
    message: parsed.message || '',
    token: parsed.token || '',
    due: reminderIsDue(parsed)
  }
}

self.onmessage = (event) => {
  const { data } = event || {}
  if (!data || data.type !== 'scan') return
  const { requestId, nodes } = data
  if (!Array.isArray(nodes)) {
    self.postMessage({ type: 'scan-result', requestId, results: [] })
    return
  }

  const results = nodes.map((node) => {
    const id = node?.id != null ? String(node.id) : null
    if (!id) return { id: null, reminder: null }
    try {
      const parsed = parseReminderFromNodeContent(node?.content)
      const reminder = buildReminderEntry(node, parsed)
      return { id, reminder }
    } catch (error) {
      console.error('[reminders-worker] parse failed', error)
      return { id, reminder: null }
    }
  })

  self.postMessage({ type: 'scan-result', requestId, results })
}
