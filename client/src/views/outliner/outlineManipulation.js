import { DATE_RE } from './constants.js'
import { REMINDER_TOKEN_REGEX } from '../../utils/reminderTokens.js'

/**
 * Clone an outline structure using structuredClone if available, otherwise JSON parse/stringify
 * @param {any} outline - The outline to clone
 * @returns {any} A deep clone of the outline
 */
export function cloneOutline(outline) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(outline)
    } catch {
      /* fall through to JSON fallback */
    }
  }
  return JSON.parse(JSON.stringify(outline))
}

/**
 * Move a node within an outline tree
 * @param {Array} nodes - The outline nodes array
 * @param {string|number} dragId - ID of the node to move
 * @param {string|number} targetId - ID of the target node
 * @param {string} position - Position relative to target ('before' or 'after')
 * @returns {Array|null} The modified outline or null if move failed
 */
export function moveNodeInOutline(nodes, dragId, targetId, position = 'before') {
  console.log('[drop] moveNodeInOutline', { dragId, targetId, position })
  if (!dragId || dragId === targetId) return null
  const clone = cloneOutline(nodes)
  const removedInfo = removeNodeById(clone, dragId)
  if (!removedInfo?.node) {
    console.log('[drop] move failed to find dragged node', { dragId })
    return null
  }
  const removed = removedInfo.node
  if (!targetId) {
    clone.push(removed)
    return clone
  }
  if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
    console.log('[drop] insert fallback to end', { dragId, targetId })
    clone.push(removed)
  }
  return clone
}

/**
 * Remove a node from an outline tree by ID
 * @param {Array} nodes - The outline nodes array
 * @param {string|number} id - ID of the node to remove
 * @returns {{node: any, index?: number}} The removed node and its index, or {node: null} if not found
 */
export function removeNodeById(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (String(node.id) === String(id)) {
      return { node: nodes.splice(i, 1)[0], index: i }
    }
    if (node.children) {
      const result = removeNodeById(node.children, id)
      if (result?.node) return result
    }
  }
  return { node: null }
}

/**
 * Insert a node relative to a target node in an outline tree
 * @param {Array} nodes - The outline nodes array
 * @param {string|number} targetId - ID of the target node
 * @param {any} newNode - The node to insert
 * @param {boolean} after - Whether to insert after (true) or before (false) the target
 * @returns {boolean} True if insertion succeeded, false otherwise
 */
export function insertNodeRelative(nodes, targetId, newNode, after) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (String(node.id) === String(targetId)) {
      nodes.splice(after ? i + 1 : i, 0, newNode)
      return true
    }
    if (node.children && insertNodeRelative(node.children, targetId, newNode, after)) return true
  }
  return false
}

/**
 * Extract the title text from a paragraph node, removing reminder tokens and dates
 * @param {Object} paragraphNode - The paragraph node from the editor
 * @returns {string} The cleaned title text or 'Untitled' if empty
 */
export function extractTitle(paragraphNode) {
  let text = ''
  const content = paragraphNode?.content
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const child = content[i]
      if (child?.type === 'text') text += child.text
    }
  }
  const cleaned = text
    .replace(REMINDER_TOKEN_REGEX, '')
    .replace(DATE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || 'Untitled'
}

/**
 * Extract date strings from a list item node
 * @param {Object} listItemNode - The list item node from the editor
 * @returns {Array<string>} Array of date strings in YYYY-MM-DD format
 */
export function extractDates(listItemNode) {
  const dates = new Set()

  const collectFromText = (text) => {
    if (!text || !text.includes('@')) return
    DATE_RE.lastIndex = 0
    let match
    while ((match = DATE_RE.exec(text))) {
      dates.add(match[0].slice(1))
    }
    DATE_RE.lastIndex = 0
  }

  const content = listItemNode?.content
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const node = content[i]
      if (!node || node.type !== 'paragraph' || !Array.isArray(node.content)) continue
      const paraContent = node.content
      for (let j = 0; j < paraContent.length; j++) {
        const child = paraContent[j]
        if (child?.type === 'text') collectFromText(child.text)
      }
    }
  }

  return dates.size ? Array.from(dates) : []
}
