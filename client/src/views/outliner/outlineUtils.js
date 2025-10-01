// ============================================================================
// Outline Utilities
// Pure functions for parsing, building, and transforming outline structures
// ============================================================================

import { REMINDER_TOKEN_REGEX } from '../../utils/reminderTokens.js'
import { loadCollapsedSetForRoot } from './collapsedState.js'

const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const STATUS_EMPTY = ''
const STARTER_PLACEHOLDER_TITLE = 'Start here'

/**
 * Normalizes body nodes by ensuring image src attributes use absolute URLs
 * Recursively processes nested content
 * @param {Array} nodes - Array of ProseMirror nodes
 * @param {Function} normalizeImageSrc - Function to normalize image URLs
 * @returns {Array} Normalized nodes
 */
export function normalizeBodyNodes(nodes, normalizeImageSrc) {
  return nodes.map(node => {
    const copy = { ...node }
    if (copy.type === 'image') {
      copy.attrs = { ...copy.attrs, src: normalizeImageSrc(copy.attrs?.src) }
    }
    if (copy.content) copy.content = normalizeBodyNodes(copy.content, normalizeImageSrc)
    return copy
  })
}

/**
 * Parses raw body content (string or object) into normalized ProseMirror nodes
 * @param {string|Array} raw - Raw body content
 * @param {Function} normalizeImageSrc - Function to normalize image URLs
 * @returns {Array} Parsed and normalized body nodes
 */
export function parseBodyContent(raw, normalizeImageSrc) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? normalizeBodyNodes(parsed, normalizeImageSrc) : []
  } catch {
    return []
  }
}

/**
 * Creates default body content for a task (paragraph with title and optional dates)
 * @param {string} titleText - Task title text
 * @param {Array} dateTokens - Array of date strings
 * @param {boolean} hasExtras - Whether body has rich content beyond plain text
 * @returns {Array} Default body nodes
 */
export function defaultBody(titleText, dateTokens, hasExtras) {
  if (!hasExtras && (!dateTokens || !dateTokens.length)) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
  }
  const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
  if (dateTokens?.length) {
    textContent.push({ type: 'text', text: ' ' + dateTokens.map(d => '@' + d).join(' ') })
  }
  return [{ type: 'paragraph', content: textContent }]
}

/**
 * Builds a ProseMirror bulletList structure from outline nodes
 * Handles collapsed state, nested children, and task attributes
 * @param {Array} nodes - Array of outline nodes
 * @param {Object} options - Build options
 * @param {boolean} options.forceExpand - Force all nodes to be expanded
 * @param {Function} options.normalizeImageSrc - Function to normalize image URLs
 * @returns {Object} ProseMirror bulletList node
 */
export function buildList(nodes, { forceExpand = false, normalizeImageSrc }) {
  const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(null)
  if (!nodes || !nodes.length) {
    return {
      type: 'bulletList',
      content: [{
        type: 'listItem',
        attrs: { dataId: null, status: STATUS_EMPTY, collapsed: false },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: STARTER_PLACEHOLDER_TITLE }] }]
      }]
    }
  }
  return {
    type: 'bulletList',
    content: nodes.map(n => {
      const titleText = n.title || 'Untitled'
      const ownDates = Array.isArray(n.ownWorkedOnDates) ? n.ownWorkedOnDates : []
      const rawBody = n.content ?? n.body ?? []
      const body = parseBodyContent(rawBody, normalizeImageSrc)
      const hasExtras = body.some(node => node.type !== 'paragraph' || (node.content || []).some(ch => ch.type !== 'text'))
      const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)
      const children = [...bodyContent]
      if (n.children?.length) children.push(buildList(n.children, { forceExpand, normalizeImageSrc }))
      const idStr = String(n.id)
      const titleLower = (titleText || '').toLowerCase()
      const bodyLower = JSON.stringify(bodyContent || []).toLowerCase()
      const archivedSelf = titleLower.includes('@archived') || bodyLower.includes('@archived')
      const futureSelf = titleLower.includes('@future') || bodyLower.includes('@future')
      const soonSelf = titleLower.includes('@soon') || bodyLower.includes('@soon')
      const tags = Array.isArray(n.tags) ? n.tags.map(tag => String(tag || '').toLowerCase()) : []
      return {
        type: 'listItem',
        attrs: { dataId: n.id, status: n.status ?? STATUS_EMPTY, collapsed: collapsedSet.has(idStr), archivedSelf, futureSelf, soonSelf, tags },
        content: children
      }
    })
  }
}

/**
 * Parses ProseMirror editor document into outline structure
 * Extracts tasks, titles, dates, and nested children
 * @param {Object} editor - TipTap editor instance
 * @param {Object} options - Parse options
 * @param {Function} options.normalizeImageSrc - Function to normalize image URLs
 * @param {Function} options.pushDebug - Debug logging function (optional)
 * @returns {Array} Array of outline nodes
 */
export function parseOutline(editor, { normalizeImageSrc, pushDebug = () => {} }) {
  const doc = editor.getJSON()
  const results = []

  function walk(node, collector) {
    if (!node?.content) return
    const lists = node.type === 'bulletList' ? [node] : (node.content || []).filter(c => c.type === 'bulletList')
    for (const bl of lists) {
      for (const li of (bl.content || [])) {
        if (li.type !== 'listItem') continue
        const bodyNodes = []
        let subList = null
        ;(li.content || []).forEach(n => {
          if (n.type === 'bulletList' && !subList) subList = n
          else bodyNodes.push(n)
        })
        const para = bodyNodes.find(n => n.type === 'paragraph')
        const title = extractTitle(para)
        const dates = extractDates(li)
        const id = li.attrs?.dataId || null
        const status = li.attrs?.status ?? STATUS_EMPTY
        const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }
        if (bodyNodes.length) {
          try {
            const cloned = JSON.parse(JSON.stringify(bodyNodes))
            item.body = normalizeBodyNodes(cloned, normalizeImageSrc)
          } catch {
            item.body = normalizeBodyNodes(bodyNodes, normalizeImageSrc)
          }
          item.content = item.body
          pushDebug('parse: captured body', { id, body: item.body })
        }
        collector.push(item)
        if (subList) walk(subList, item.children)
      }
    }
  }

  walk(doc, results)
  return results
}

/**
 * Clones an outline using structuredClone if available, fallback to JSON
 * @param {Array} outline - Outline to clone
 * @returns {Array} Cloned outline
 */
export function cloneOutline(outline) {
  return typeof structuredClone === 'function'
    ? structuredClone(outline)
    : JSON.parse(JSON.stringify(outline))
}

/**
 * Moves a node within an outline from one position to another
 * Used for drag-and-drop reordering
 * @param {Array} nodes - Outline nodes
 * @param {string} dragId - ID of node being moved
 * @param {string} targetId - ID of target node (or null for append to end)
 * @param {string} position - 'before' or 'after' the target
 * @returns {Array|null} Modified outline or null if move failed
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
 * Removes a node by ID from outline, returning the removed node and its index
 * @param {Array} nodes - Outline nodes
 * @param {string} id - Node ID to remove
 * @returns {Object} { node, index } or { node: null } if not found
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
 * Inserts a node relative to a target node (before or after)
 * @param {Array} nodes - Outline nodes
 * @param {string} targetId - Target node ID
 * @param {Object} newNode - Node to insert
 * @param {boolean} after - Insert after (true) or before (false) target
 * @returns {boolean} True if insert succeeded
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
 * Extracts title text from a paragraph node
 * Removes reminder tokens and date tokens, cleans whitespace
 * @param {Object} paragraphNode - ProseMirror paragraph node
 * @returns {string} Extracted title or 'Untitled'
 */
export function extractTitle(paragraphNode) {
  let text = ''
  if (paragraphNode?.content) paragraphNode.content.forEach(n => { if (n.type === 'text') text += n.text })
  const cleaned = text
    .replace(REMINDER_TOKEN_REGEX, '')
    .replace(DATE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned || 'Untitled'
}

/**
 * Extracts date tokens from a list item node
 * Finds all @YYYY-MM-DD patterns in paragraph content
 * @param {Object} listItemNode - ProseMirror listItem node
 * @returns {Array} Array of date strings (without @ prefix)
 */
export function extractDates(listItemNode) {
  const dates = new Set()
  ;(listItemNode.content || []).forEach(n => {
    if (n.type === 'paragraph' && n.content) {
      let t = ''
      n.content.forEach(m => { if (m.type === 'text') t += m.text })
      ;(t.match(DATE_RE) || []).forEach(s => dates.add(s.slice(1)))
    }
  })
  return Array.from(dates)
}
