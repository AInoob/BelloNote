export function visitNodeTexts(nodes, visitor) {
  if (!nodes) return false
  const stack = []
  if (Array.isArray(nodes)) {
    for (let i = 0; i < nodes.length; i += 1) stack.push(nodes[i])
  } else {
    stack.push(nodes)
  }
  while (stack.length) {
    const current = stack.pop()
    if (current == null) continue
    if (typeof current === 'string') {
      if (visitor(current) === true) return true
      continue
    }
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) stack.push(current[i])
      continue
    }
    if (typeof current === 'object') {
      if (typeof current.text === 'string' && visitor(current.text) === true) return true
      const content = current.content
      if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i += 1) stack.push(content[i])
      }
    }
  }
  return false
}
