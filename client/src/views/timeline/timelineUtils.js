/**
 * Utility functions for the Timeline view
 */

import { DATE_RE } from './constants.js'

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
  const seedSet = new Set(seedIds)
  const byId = new Map()
  const rootsSet = new Set()
  
  const ensureNode = (seg) => {
    if (!byId.has(seg.id)) {
      byId.set(seg.id, {
        id: seg.id,
        title: seg.title,
        status: seg.status ?? '',
        content: seg.content ?? null,
        children: [],
        ownWorkedOnDates: []
      })
    }
    return byId.get(seg.id)
  }
  
  items.forEach(it => {
    const path = Array.isArray(it.path) ? it.path : []
    if (!path.length) return
    
    rootsSet.add(path[0].id)
    
    for (let i = 0; i < path.length; i++) {
      const cur = ensureNode(path[i])
      
      // Mark the node if it is a seed (directly logged for the day)
      if (date && seedSet.has(cur.id) && !cur.ownWorkedOnDates.includes(date)) {
        cur.ownWorkedOnDates.push(date)
      }
      
      const prev = i > 0 ? ensureNode(path[i - 1]) : null
      if (prev) {
        if (!prev.children.find(ch => ch.id === cur.id)) {
          prev.children.push(cur)
        }
      }
    }
  })
  
  const roots = Array.from(rootsSet).map(id => byId.get(id)).filter(Boolean)
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
  const t = (node?.title || '').toLowerCase()
  const bodyLower = JSON.stringify(node?.content || []).toLowerCase()
  const needle = `@${tag}`
  return t.includes(needle) || bodyLower.includes(needle)
}

/**
 * Check if a node has a date token in its title or content
 * 
 * @param {Object} node - The node to check
 * @returns {boolean} True if a date token is found
 */
export function hasDate(node) {
  const t = node?.title || ''
  const body = JSON.stringify(node?.content || [])
  return DATE_RE.test(t) || DATE_RE.test(body)
}

/**
 * Collect tasks tagged with @soon or @future from the outline roots
 * Tasks are categorized based on tag inheritance and date presence
 * 
 * @param {Array} roots - Array of root nodes
 * @returns {Object} Object with soonRoots and futureRoots arrays
 */
export function collectSoonAndFuture(roots) {
  const soonRoots = []
  const futureRoots = []
  
  function walk(node, parentSoon = false, parentFuture = false) {
    const selfSoon = hasTag(node, 'soon')
    const selfFuture = hasTag(node, 'future')
    const effSoon = parentSoon || selfSoon
    const effFuture = parentFuture || selfFuture
    const dated = hasDate(node)
    
    // Soon items without dates go to Soon section
    if (effSoon && !dated) {
      soonRoots.push(node)
      return
    }
    
    // Future items (not under Soon) without dates go to Future section
    if (effFuture && !parentSoon && !dated) {
      futureRoots.push(node)
      return
    }
    
    // Recurse into children
    for (const ch of (node.children || [])) {
      walk(ch, effSoon, effFuture)
    }
  }
  
  for (const r of (roots || [])) {
    walk(r, false, false)
  }
  
  return { soonRoots, futureRoots }
}

