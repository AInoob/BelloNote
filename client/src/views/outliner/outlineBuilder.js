import { STATUS_EMPTY, STARTER_PLACEHOLDER_TITLE } from './constants.js'
import { parseBodyContent, defaultBody } from './outlineParser.js'
import { loadCollapsedSetForRoot } from './collapsedState.js'

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
      const children = [...bodyContent]
      if (n.children?.length) children.push(buildList(n.children, forceExpand, normalizeImageSrc))
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
            item.body = normalizeBodyNodes(cloned)
          } catch {
            item.body = normalizeBodyNodes(bodyNodes)
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

