// ============================================================================
// Outline Tree Helpers
// Functions for building, parsing, and manipulating outline tree structures
// ============================================================================

import { absoluteUrl } from '../../api.js'
import { DATE_RE, STATUS_EMPTY, STARTER_PLACEHOLDER_TITLE } from './constants.js'
import { REMINDER_TOKEN_REGEX, stripReminderDisplayBreaks } from '../../utils/reminderTokens.js'

// ============================================================================
// Body Content Helpers
// ============================================================================

/**
 * Recursively normalizes body nodes by converting image src to absolute URLs
 * @param {Array} nodes - Array of ProseMirror nodes
 * @returns {Array} Normalized nodes with absolute image URLs
 */
export function normalizeBodyNodes(nodes) {
  return nodes.map(node => {
    const copy = { ...node }

    // Convert relative image URLs to absolute URLs
    if (copy.type === 'image') {
      copy.attrs = { ...copy.attrs, src: absoluteUrl(copy.attrs?.src) }
    }

    // Recursively normalize child nodes
    if (copy.content) copy.content = normalizeBodyNodes(copy.content)
    return copy
  })
}

/**
 * Parses body content from raw JSON or object
 * @param {string|Array|Object} raw - Raw body content (JSON string or object)
 * @returns {Array} Parsed and normalized array of ProseMirror nodes
 */
export function parseBodyContent(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? normalizeBodyNodes(parsed) : []
  } catch {
    return []
  }
}

/**
 * Creates default body content for a task (just title + optional date tokens)
 * @param {string} titleText - Task title text
 * @param {Array<string>} dateTokens - Date tokens (e.g., ['2024-01-15'])
 * @param {boolean} hasExtras - Whether body has rich content (images, code blocks, etc.)
 * @returns {Array} ProseMirror paragraph node array
 */
export function defaultBody(titleText, dateTokens, hasExtras) {
  // If no extras and no dates, just return simple paragraph with title
  if (!hasExtras && (!dateTokens || !dateTokens.length)) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
  }

  // Build paragraph with title and date tokens
  const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
  if (dateTokens?.length) {
    textContent.push({ type: 'text', text: ' ' + dateTokens.map(d => '@' + d).join(' ') })
  }
  return [{ type: 'paragraph', content: textContent }]
}

// ============================================================================
// Title and Date Extraction
// ============================================================================

/**
 * Extracts title text from a paragraph node
 * Strips reminder tokens, date tags, and extra whitespace
 * @param {Object} paragraphNode - ProseMirror paragraph node
 * @returns {string} Cleaned title text
 */
export function extractTitle(paragraphNode) {
  let text = ''

  // Concatenate all text content from paragraph
  if (paragraphNode?.content) paragraphNode.content.forEach(n => { if (n.type === 'text') text += n.text })

  // Clean up text: remove reminder tokens, dates, and extra whitespace
  const cleaned = text
    .replace(REMINDER_TOKEN_REGEX, '')
    .replace(DATE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return cleaned || 'Untitled'
}

/**
 * Extracts all date tags from a list item node
 * Searches all paragraphs for @YYYY-MM-DD patterns
 * @param {Object} listItemNode - ProseMirror listItem node
 * @returns {Array<string>} Array of date strings (YYYY-MM-DD format, without @ prefix)
 */
export function extractDates(listItemNode) {
  const dates = new Set()

  ;(listItemNode.content || []).forEach(n => {
    if (n.type === 'paragraph' && n.content) {
      // Concatenate text content
      let t = ''
      n.content.forEach(m => { if (m.type === 'text') t += m.text })

      // Find all @YYYY-MM-DD patterns and strip @ prefix
      ;(t.match(DATE_RE) || []).forEach(s => dates.add(s.slice(1)))
    }
  })

  return Array.from(dates)
}

// ============================================================================
// Outline Tree Building
// ============================================================================

/**
 * Builds a ProseMirror bulletList structure from outline tree nodes
 * This converts the flat outline tree structure into nested ProseMirror nodes
 * @param {Array} nodes - Array of outline tree nodes
 * @param {Set<string>} collapsedSet - Set of collapsed task IDs
 * @returns {Object} ProseMirror bulletList node
 */
export function buildList(nodes, collapsedSet = new Set()) {
  // Handle empty outline - create placeholder task
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
      const body = parseBodyContent(rawBody)

      // Check if body has rich content (images, code blocks, etc.) beyond simple paragraphs
      const hasExtras = body.some(node => node.type !== 'paragraph' || (node.content || []).some(ch => ch.type !== 'text'))

      // Use stored body or generate default body
      const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)

      // Build list item children (body content + nested children)
      const children = [...bodyContent]
      if (n.children?.length) children.push(buildList(n.children, collapsedSet))

      // Extract metadata flags from title and body text
      const idStr = String(n.id)
      const titleLower = (titleText || '').toLowerCase()
      const bodyLower = JSON.stringify(bodyContent || []).toLowerCase()
      const archivedSelf = titleLower.includes('@archived') || bodyLower.includes('@archived')
      const futureSelf = titleLower.includes('@future') || bodyLower.includes('@future')
      const soonSelf = titleLower.includes('@soon') || bodyLower.includes('@soon')
      const tags = Array.isArray(n.tags) ? n.tags.map(tag => String(tag || '').toLowerCase()) : []

      return {
        type: 'listItem',
        attrs: {
          dataId: n.id,
          status: n.status ?? STATUS_EMPTY,
          collapsed: collapsedSet.has(idStr),
          archivedSelf,
          futureSelf,
          soonSelf,
          tags
        },
        content: children
      }
    })
  }
}

// ============================================================================
// Outline Tree Parsing
// ============================================================================

/**
 * Parses ProseMirror document into outline tree structure
 * This is the inverse of buildList - converts ProseMirror nodes to outline tree
 * @param {Object} doc - ProseMirror document JSON
 * @param {Function} pushDebug - Debug logging function
 * @returns {Array} Outline tree (array of root-level tasks with nested children)
 */
export function parseOutline(doc, pushDebug = () => {}) {
  const results = []

  /**
   * Recursively walks ProseMirror bulletList nodes and builds outline tree
   * @param {Object} node - ProseMirror node to walk
   * @param {Array} collector - Array to collect parsed tasks into
   */
  function walk(node, collector) {
    if (!node?.content) return

    // Find all bulletList nodes (handle both direct bulletLists and nested in other nodes)
    const lists = node.type === 'bulletList' ? [node] : (node.content || []).filter(c => c.type === 'bulletList')

    for (const bl of lists) {
      for (const li of (bl.content || [])) {
        if (li.type !== 'listItem') continue

        // Separate list item content into body nodes and nested lists
        const bodyNodes = []
        let subList = null
        ;(li.content || []).forEach(n => {
          if (n.type === 'bulletList' && !subList) subList = n // First bulletList becomes children
          else bodyNodes.push(n) // Everything else is body content
        })

        // Extract title from first paragraph
        const para = bodyNodes.find(n => n.type === 'paragraph')
        const title = extractTitle(para)

        // Extract dates from all paragraphs
        const dates = extractDates(li)

        // Build outline item
        const id = li.attrs?.dataId || null
        const status = li.attrs?.status ?? STATUS_EMPTY
        const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }

        // Store body content if present (for rich content: images, code blocks, etc.)
        if (bodyNodes.length) {
          try {
            const cloned = JSON.parse(JSON.stringify(bodyNodes))
            item.body = normalizeBodyNodes(cloned)
          } catch {
            item.body = normalizeBodyNodes(bodyNodes)
          }
          item.content = item.body
          pushDebug('parse: captured body', { id, body: item.body })
        }

        collector.push(item)

        // Recursively parse nested children
        if (subList) walk(subList, item.children)
      }
    }
  }

  walk(doc, results)
  return results
}

// ============================================================================
// Tree Manipulation Helpers
// ============================================================================

/**
 * Deep clones an outline tree
 * @param {Array} nodes - Outline tree nodes
 * @returns {Array} Cloned outline tree
 */
export function cloneOutline(nodes) {
  if (typeof structuredClone === 'function') return structuredClone(nodes)
  return JSON.parse(JSON.stringify(nodes))
}

/**
 * Recursively removes a node from outline tree by ID
 * @param {Array} nodes - Outline tree nodes
 * @param {string} removeId - ID of node to remove
 * @returns {Object|null} Object with removed node and parent info, or null if not found
 */
export function removeNodeById(nodes, removeId) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (String(node.id) === String(removeId)) {
      const removed = nodes.splice(i, 1)[0]
      return { node: removed, parent: nodes, index: i }
    }
    if (node.children?.length) {
      const found = removeNodeById(node.children, removeId)
      if (found) return found
    }
  }
  return null
}

/**
 * Recursively inserts a node relative to target node
 * @param {Array} nodes - Outline tree nodes
 * @param {string} targetId - ID of target node
 * @param {Object} newNode - Node to insert
 * @param {boolean} after - Insert after target (true) or before (false)
 * @returns {boolean} True if inserted successfully
 */
export function insertNodeRelative(nodes, targetId, newNode, after = false) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (String(node.id) === String(targetId)) {
      const insertIndex = after ? i + 1 : i
      nodes.splice(insertIndex, 0, newNode)
      return true
    }
    if (node.children?.length && insertNodeRelative(node.children, targetId, newNode, after)) {
      return true
    }
  }
  return false
}

/**
 * Moves a task node to a new position in the outline tree
 * Used for drag-and-drop reordering
 * @param {Array} nodes - Root nodes of outline tree
 * @param {string} dragId - ID of task being moved
 * @param {string|null} targetId - ID of target task to move relative to (null = append to end)
 * @param {string} position - 'before' or 'after' target
 * @returns {Array|null} Updated outline tree, or null if move failed
 */
export function moveNodeInOutline(nodes, dragId, targetId, position = 'before') {
  console.log('[drop] moveNodeInOutline', { dragId, targetId, position })
  if (!dragId || dragId === targetId) return null

  const clone = cloneOutline(nodes)

  // Remove dragged node from tree
  const removedInfo = removeNodeById(clone, dragId)
  if (!removedInfo?.node) {
    console.log('[drop] move failed to find dragged node', { dragId })
    return null
  }

  const removed = removedInfo.node

  // If no target, append to end
  if (!targetId) {
    clone.push(removed)
    return clone
  }

  // Insert relative to target
  if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
    console.log('[drop] insert fallback to end', { dragId, targetId })
    clone.push(removed) // Fallback: append to end if insert failed
  }

  return clone
}
