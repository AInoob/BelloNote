/**
 * Deep clones an array of outline nodes recursively
 * @param {Array} nodes - Array of outline nodes to clone
 * @returns {Array} A deep clone of the outline nodes
 */
export function cloneOutlineNodes(nodes) {
  if (!Array.isArray(nodes)) return []

  return nodes.map((node) => ({
    ...node,
    content: Array.isArray(node.content)
      ? JSON.parse(JSON.stringify(node.content))
      : node.content,
    children: cloneOutlineNodes(node.children)
  }))
}

/**
 * Builds an index map of all outline nodes by their ID
 * Traverses the outline tree and creates a Map for quick lookup by ID
 * @param {Array} [roots=[]] - Array of root outline nodes
 * @returns {Map<string, Object>} Map of node ID to node object
 */
export function buildOutlineIndex(roots = []) {
  const map = new Map()

  /**
   * Recursive walker that adds nodes to the index
   * @param {Array} nodes - Nodes to walk through
   */
  const walk = (nodes) => {
    nodes.forEach((node) => {
      if (!node || typeof node !== 'object') return

      if (node.id != null) {
        map.set(String(node.id), node)
      }

      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children)
      }
    })
  }

  walk(Array.isArray(roots) ? roots : [])
  return map
}
