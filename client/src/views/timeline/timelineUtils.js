/**
 * Utility functions for the Timeline view
 */

import { DATE_RE } from './constants.js'

function contentTextIncludes(nodes, predicate) {
  if (!nodes) return false
  const stack = []
  if (Array.isArray(nodes)) {
    for (let i = 0; i < nodes.length; i++) stack.push(nodes[i])
  } else {
    stack.push(nodes)
  }
  while (stack.length) {
    const current = stack.pop()
    if (current == null) continue
    if (typeof current === 'string') {
      if (predicate(current)) return true
      continue
    }
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) stack.push(current[i])
      continue
    }
    if (typeof current === 'object') {
      if (typeof current.text === 'string' && predicate(current.text)) return true
      const content = current.content
      if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) stack.push(content[i])
      }
    }
  }
  return false
}

function analyzeNodeMarkers(node) {
  if (!node) return { hasDate: false }
  const markers = { hasDate: false }
  const title = typeof node.title === 'string' ? node.title : ''
  if (title) {
    const titleLower = title.toLowerCase()
    if (DATE_RE.test(title)) markers.hasDate = true
  }
  if (markers.hasDate) return markers
  contentTextIncludes(node.content, text => {
    if (!markers.hasDate && DATE_RE.test(text)) markers.hasDate = true
    return markers.hasDate
  })
  return markers
}

/**
 * Build an outline tree structure from flat items with path arrays
 * This reconstructs the hierarchy so we can render with OutlinerView in read-only mode
 * 
 * @param {Array} items - Array of items with path arrays
 * @param {Array} seedIds - Array of IDs that were directly logged for the day
 * @param {string|null} date - The date these items are associated with
 * @returns {Array} Array of root nodes with nested children
 */
export function buildOutlineFromItems(items, seedIds = [], date = null) {
  const seedSet = seedIds?.length ? new Set(seedIds) : null
  const byId = new Map()
  const rootsSet = new Set()

  const ensureNode = (seg) => {
    if (!seg) return null
    const existing = byId.get(seg.id)
    if (existing) return existing
    const created = {
      id: seg.id,
      title: seg.title,
      status: seg.status ?? '',
      content: seg.content ?? null,
      children: [],
      childIds: new Set(),
      ownWorkedOnDates: [],
      ownWorkedOnDatesSet: new Set()
    }
    byId.set(seg.id, created)
    return created
  }

  if (Array.isArray(items)) {
    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const it = items[itemIdx]
      const path = Array.isArray(it?.path) ? it.path : []
      if (!path.length) continue

      rootsSet.add(path[0].id)

      for (let i = 0; i < path.length; i++) {
        const cur = ensureNode(path[i])
        if (!cur) continue

        if (seedSet && date && seedSet.has(cur.id) && !cur.ownWorkedOnDatesSet.has(date)) {
          cur.ownWorkedOnDatesSet.add(date)
          cur.ownWorkedOnDates.push(date)
        }

        if (i > 0) {
          const prev = ensureNode(path[i - 1])
          if (prev && !prev.childIds.has(cur.id)) {
            prev.childIds.add(cur.id)
            prev.children.push(cur)
          }
        }
      }
    }
  }
  
  const roots = Array.from(rootsSet).map(id => byId.get(id)).filter(Boolean)
  for (const node of byId.values()) {
    if (node.childIds) delete node.childIds
    if (node.ownWorkedOnDatesSet) delete node.ownWorkedOnDatesSet
  }
  return roots
}

/**
 * Check if a node has a specific tag in its title or content
 * 
 * @param {Object} node - The node to check
 * @param {string} tag - The tag to search for (without @ prefix)
 * @returns {boolean} True if the tag is found
 */
export function hasTag(node, tag) {
  const needle = `@${tag}`.toLowerCase()
  const title = typeof node?.title === 'string' ? node.title.toLowerCase() : ''
  if (title.includes(needle)) return true
  return contentTextIncludes(node?.content, text => text.toLowerCase().includes(needle))
}

/**
 * Check if a node has a date token in its title or content
 * 
 * @param {Object} node - The node to check
 * @returns {boolean} True if a date token is found
 */
export function hasDate(node) {
  return analyzeNodeMarkers(node).hasDate
}
