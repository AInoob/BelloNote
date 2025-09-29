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

export function buildOutlineIndex(roots = []) {
  const map = new Map()

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
