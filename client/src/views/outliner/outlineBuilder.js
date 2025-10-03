import { STATUS_EMPTY, STARTER_PLACEHOLDER_TITLE } from './constants.js'
import { parseBodyContent, defaultBody } from './outlineParser.js'
import { loadCollapsedSetForRoot } from './collapsedState.js'

/**
 * Inspect a body node tree for archived tag markers without expensive stringification.
 * @param {Array} nodes - Body content nodes
 * @returns {{ archived: boolean }} Token presence flags
 */
function detectBodyTokens(nodes) {
  const flags = { archived: false }
  if (!nodes?.length) return flags
  const stack = []
  for (let i = 0; i < nodes.length; i++) stack.push(nodes[i])
  while (stack.length && !flags.archived) {
    const current = stack.pop()
    if (current == null) continue
    if (typeof current === 'string') {
      if (!current.includes('@archived')) continue
      const lower = current.toLowerCase()
      if (lower.includes('@archived')) {
        flags.archived = true
        break
      }
      continue
    }
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) stack.push(current[i])
      continue
    }
    if (typeof current === 'object') {
      if (typeof current.text === 'string' && current.text.includes('@archived')) {
        if (current.text.toLowerCase().includes('@archived')) {
          flags.archived = true
          break
        }
      }
      const content = current.content
      if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) stack.push(content[i])
      }
    }
  }
  return flags
}

/**
 * Build a ProseMirror list structure from outline nodes
 * @param {Array} nodes - Array of outline nodes
 * @param {boolean} forceExpand - Whether to force expand all nodes
 * @param {Function} normalizeImageSrc - Function to normalize image src
 * @returns {Object} ProseMirror bulletList node
 */
export function buildList(nodes, forceExpand, normalizeImageSrc) {
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
      let children = bodyContent
      if (n.children?.length) {
        children = bodyContent.length ? bodyContent.slice() : []
        children.push(buildList(n.children, forceExpand, normalizeImageSrc))
      }
      const idStr = String(n.id)
      const titleLower = (titleText || '').toLowerCase()
      const bodyFlags = detectBodyTokens(bodyContent)
      const archivedSelf = titleLower.includes('@archived') || bodyFlags.archived
      const tags = Array.isArray(n.tags) ? n.tags.map(tag => String(tag || '').toLowerCase()) : []
      return {
        type: 'listItem',
        attrs: { dataId: n.id, status: n.status ?? STATUS_EMPTY, collapsed: collapsedSet.has(idStr), archivedSelf, tags },
        content: children
      }
    })
  }
}

/**
 * Parse the editor content into an outline structure
 * @param {Object} editor - TipTap editor instance
 * @param {Function} extractTitle - Function to extract title from paragraph
 * @param {Function} extractDates - Function to extract dates from list item
 * @param {Function} normalizeBodyNodes - Function to normalize body nodes
 * @param {Function} pushDebug - Debug logging function
 * @returns {Array} Array of outline nodes
 */
export function parseOutline(editor, extractTitle, extractDates, normalizeBodyNodes, pushDebug) {
  const doc = editor.getJSON()
  const results = []
  const normalize = typeof normalizeBodyNodes === 'function' ? normalizeBodyNodes : null
  
  function walk(node, collector) {
    if (!node?.content) return
    const candidates = node.type === 'bulletList' ? [node] : node.content || []
    for (let listIdx = 0; listIdx < candidates.length; listIdx++) {
      const bl = candidates[listIdx]
      if (!bl || bl.type !== 'bulletList' || !Array.isArray(bl.content)) continue
      const listItems = bl.content
      for (let itemIdx = 0; itemIdx < listItems.length; itemIdx++) {
        const li = listItems[itemIdx]
        if (li.type !== 'listItem') continue
        const bodyNodes = []
        let subList = null
        let para = null
        const liContent = li.content || []
        for (let idx = 0; idx < liContent.length; idx++) {
          const n = liContent[idx]
          if (n.type === 'bulletList') {
            if (!subList) subList = n
            continue
          }
          bodyNodes.push(n)
          if (!para && n.type === 'paragraph') para = n
        }
        const title = extractTitle(para)
        const dates = extractDates(li)
        const id = li.attrs?.dataId || null
        const status = li.attrs?.status ?? STATUS_EMPTY
        const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }
        if (bodyNodes.length) {
          item.body = normalize ? normalize(bodyNodes) : bodyNodes
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
