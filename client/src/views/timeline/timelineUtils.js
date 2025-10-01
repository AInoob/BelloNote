// ============================================================================
// Timeline Utility Functions
// Helper functions for timeline data processing and rendering
// ============================================================================

/** Regex to match date tags in format @YYYY-MM-DD */
const DATE_RE = /@\d{4}-\d{2}-\d{2}\b/

/**
 * Builds an outline tree structure from timeline items
 * Reconstructs hierarchy from path arrays for read-only rendering
 * @param {Array} items - Timeline items with path arrays
 * @param {Array} [seedIds=[]] - IDs of items directly logged for the day
 * @param {string|null} [date=null] - Date to mark on seed items
 * @returns {Array} Array of root nodes with children
 */
export function buildOutlineFromItems(items, seedIds = [], date = null) {
  const seedSet = new Set(seedIds)
  const byId = new Map()
  const rootsSet = new Set()
  const ensureNode = (seg) => {
    if (!byId.has(seg.id)) byId.set(seg.id, { id: seg.id, title: seg.title, status: seg.status ?? '', content: seg.content ?? null, children: [], ownWorkedOnDates: [] })
    return byId.get(seg.id)
  }
  items.forEach(it => {
    const path = Array.isArray(it.path) ? it.path : []
    if (!path.length) return
    rootsSet.add(path[0].id)
    for (let i = 0; i < path.length; i++) {
      const cur = ensureNode(path[i])
      // mark the node if it is a seed (directly logged for the day)
      if (date && seedSet.has(cur.id) && !cur.ownWorkedOnDates.includes(date)) cur.ownWorkedOnDates.push(date)
      const prev = i > 0 ? ensureNode(path[i - 1]) : null
      if (prev) {
        if (!prev.children.find(ch => ch.id === cur.id)) prev.children.push(cur)
      }
    }
  })
  const roots = Array.from(rootsSet).map(id => byId.get(id)).filter(Boolean)
  return roots
}

/**
 * Checks if a node contains a specific tag in title or content
 * @param {Object} node - Node to check
 * @param {string} tag - Tag to search for (without @)
 * @returns {boolean} True if node contains the tag
 */
export function hasTag(node, tag) {
  const t = (node?.title || '').toLowerCase()
  const bodyLower = JSON.stringify(node?.content || []).toLowerCase()
  const needle = `@${tag}`
  return t.includes(needle) || bodyLower.includes(needle)
}

/**
 * Checks if a node contains a date tag
 * @param {Object} node - Node to check
 * @returns {boolean} True if node contains a date tag
 */
export function hasDate(node) {
  const t = node?.title || ''
  const body = JSON.stringify(node?.content || [])
  return DATE_RE.test(t) || DATE_RE.test(body)
}

/**
 * Collects tasks tagged with @soon or @future from outline roots
 * Respects tag inheritance and excludes dated items
 * @param {Array} roots - Root nodes to scan
 * @returns {Object} Object with soonRoots and futureRoots arrays
 */
export function collectSoonAndFuture(roots) {
  const soonRoots = []
  const futureRoots = []
  function walk(node, parentSoon=false, parentFuture=false) {
    const selfSoon = hasTag(node, 'soon')
    const selfFuture = hasTag(node, 'future')
    const effSoon = parentSoon || selfSoon
    const effFuture = parentFuture || selfFuture
    const selfDate = hasDate(node)
    // if a node has a date tag, it goes in the timeline, not soon/future
    if (selfDate) return
    const children = Array.isArray(node.children) ? node.children : []
    if (effSoon) {
      // If this node is effectively "soon" and doesn't have a date tag, add it
      if (!soonRoots.find(r => r.id === node.id)) soonRoots.push(node)
    } else if (effFuture) {
      // If this node is effectively "future" and doesn't have a date tag, add it
      if (!futureRoots.find(r => r.id === node.id)) futureRoots.push(node)
    } else {
      // Neither soon nor future; traverse children
      children.forEach(child => walk(child, effSoon, effFuture))
    }
  }
  roots.forEach(root => walk(root))
  return { soonRoots, futureRoots }
}
