const cloneRichContent = typeof structuredClone === 'function'
  ? (value) => {
      try {
        return structuredClone(value)
      } catch {
        return JSON.parse(JSON.stringify(value))
      }
    }
  : (value) => JSON.parse(JSON.stringify(value))

export function cloneOutlineNodes(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return []
  const result = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node || typeof node !== 'object') {
      result[i] = node
      continue
    }
    result[i] = {
      ...node,
      content: Array.isArray(node.content) ? cloneRichContent(node.content) : node.content,
      children: cloneOutlineNodes(node.children)
    }
  }
  return result
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
