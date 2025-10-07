import dayjs from 'dayjs'
import {
  REMINDER_TOKEN_REGEX,
  buildReminderToken,
  encodeReminderDisplayTokens,
  parseReminderTokenFromText,
  upsertReminderTokenInText
} from './reminderTokens.js'

const isTextNode = (node) => node?.type?.name === 'text'

function appendTextWithSpace(nodes, schema, text) {
  if (typeof text !== 'string' || !text.length) return
  if (nodes.length) {
    const last = nodes[nodes.length - 1]
    if (isTextNode(last) && typeof last.text === 'string' && last.text.length) {
      if (!/\s$/u.test(last.text)) {
        nodes[nodes.length - 1] = schema.text(`${last.text} `, last.marks)
      }
    } else {
      nodes.push(schema.text(' '))
    }
  }
  nodes.push(schema.text(text))
}

export function findReminderTarget(doc, taskId) {
  if (!doc || taskId == null) return null
  let result = null
  doc.descendants((node, pos) => {
    if (node.type?.name !== 'listItem') return undefined
    if (String(node.attrs?.dataId) !== String(taskId)) return undefined
    if (!node.childCount) return false
    const paragraphNode = node.child(0)
    if (!paragraphNode || paragraphNode.type?.name !== 'paragraph') return false
    result = {
      listItemNode: node,
      listItemPos: pos,
      paragraphNode,
      paragraphPos: pos + 1,
      existingReminder: parseReminderTokenFromText(paragraphNode.textContent || '')
    }
    return false
  })
  return result
}

export function deriveReminderUpdate(existing, action, { remindAt, message } = {}) {
  if (!action) return existing || null
  const resolvedMessage = existing?.message && !message ? existing.message : (message || existing?.message || '')
  switch (action) {
    case 'schedule':
      if (!remindAt) return existing || null
      return { status: 'incomplete', remindAt, message: resolvedMessage }
    case 'dismiss':
      if (!existing) return null
      return { status: 'dismissed', remindAt: existing.remindAt, message: existing.message }
    case 'complete':
      if (existing) {
        return { status: 'completed', remindAt: existing.remindAt, message: existing.message }
      }
      if (!remindAt) return null
      return { status: 'completed', remindAt, message: resolvedMessage }
    case 'remove':
      return null
    default:
      return existing || null
  }
}

export function buildReminderParagraph({ schema, paragraphNode, action, reminder, todayIso }) {
  if (!schema || !paragraphNode) return null
  const paragraphType = schema.nodes?.paragraph
  if (!paragraphType) return null

  const token = reminder ? buildReminderToken(reminder) : null
  const displayToken = token ? encodeReminderDisplayTokens(token) : null

  const newChildren = []
  let tokenHandled = false
  paragraphNode.content?.forEach((child) => {
    if (isTextNode(child) && typeof child.text === 'string') {
      if (REMINDER_TOKEN_REGEX.test(child.text)) tokenHandled = true
      const updated = upsertReminderTokenInText(child.text, token)
      if (updated) newChildren.push(schema.text(updated, child.marks))
    } else {
      newChildren.push(child)
    }
  })

  if (!token && !tokenHandled) return null

  const adjustedChildren = []
  let tokenPresent = false
  const tokenText = displayToken || token || ''
  newChildren.forEach((child) => {
    if (!tokenPresent && isTextNode(child) && typeof child.text === 'string') {
      const text = child.text
      const match = REMINDER_TOKEN_REGEX.exec(text)
      if (match) {
        tokenPresent = true
        const before = text.slice(0, match.index)
        if (before.trim().length) {
          adjustedChildren.push(schema.text(before.replace(/\s+$/u, ' '), child.marks))
        } else if (before.length && !adjustedChildren.length) {
          adjustedChildren.push(schema.text(before, child.marks))
        }
        const after = text.slice(match.index + match[0].length)
        if (after.trim().length) {
          adjustedChildren.push(schema.text(after.replace(/^\s+/u, ''), child.marks))
        }
        return
      }
    }
    adjustedChildren.push(child)
  })

  let processedChildren = adjustedChildren.filter(node => {
    if (!isTextNode(node)) return true
    return typeof node.text === 'string' && node.text.length > 0
  })

  let addedTodayTag = false
  if (action === 'complete') {
    const todayTag = `@${todayIso || dayjs().format('YYYY-MM-DD')}`
    const hasTodayTag = processedChildren.some(node => isTextNode(node) && typeof node.text === 'string' && node.text.includes(todayTag))
    if (!hasTodayTag) {
      appendTextWithSpace(processedChildren, schema, todayTag)
      addedTodayTag = true
    }
  }

  if (tokenText) {
    appendTextWithSpace(processedChildren, schema, encodeReminderDisplayTokens(tokenText))
  }

  const paragraph = paragraphType.create(paragraphNode.attrs, processedChildren)
  return {
    paragraph,
    addedTodayTag
  }
}
