const HIGHLIGHT_MARK_TYPE = 'highlight'

function stripMarksFromArray(array) {
  if (!Array.isArray(array) || array.length === 0) return array
  let changed = false
  const next = new Array(array.length)
  for (let i = 0; i < array.length; i += 1) {
    const original = array[i]
    const cleaned = stripMarksFromValue(original)
    if (cleaned !== original) changed = true
    next[i] = cleaned
  }
  return changed ? next : array
}

function stripMarksFromValue(value) {
  if (Array.isArray(value)) return stripMarksFromArray(value)
  if (value && typeof value === 'object') return stripMarksFromNode(value)
  return value
}

function stripMarksFromNode(node) {
  if (!node || typeof node !== 'object') return node
  let marksChanged = false
  let contentChanged = false
  let marks = node.marks
  if (Array.isArray(marks) && marks.length) {
    const filtered = marks.filter((mark) => mark?.type !== HIGHLIGHT_MARK_TYPE)
    if (filtered.length !== marks.length) {
      marks = filtered
      marksChanged = true
    }
  }
  let content = node.content
  if (Array.isArray(content) && content.length) {
    const cleanedContent = stripMarksFromArray(content)
    if (cleanedContent !== content) {
      content = cleanedContent
      contentChanged = true
    }
  }
  if (!marksChanged && !contentChanged) return node
  const clone = { ...node }
  if (marksChanged) {
    if (marks && marks.length) clone.marks = marks
    else delete clone.marks
  }
  if (contentChanged) clone.content = content
  return clone
}

function stripMarksFromBody(value) {
  if (!value) return value
  if (Array.isArray(value)) return stripMarksFromArray(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value
    try {
      const parsed = JSON.parse(value)
      const cleaned = Array.isArray(parsed)
        ? stripMarksFromArray(parsed)
        : stripMarksFromValue(parsed)
      if (cleaned !== parsed) return JSON.stringify(cleaned)
    } catch {
      return value
    }
    return value
  }
  if (typeof value === 'object') return stripMarksFromNode(value)
  return value
}

export function stripHighlightMarksFromDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc
  return stripMarksFromNode(doc)
}

export function stripHighlightMarksFromOutlineNodes(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return nodes
  let changed = false
  const next = nodes.map((node) => {
    if (!node || typeof node !== 'object') return node
    let updated = node
    const bodyCleaned = stripMarksFromBody(node.body)
    if (bodyCleaned !== node.body) {
      if (updated === node) updated = { ...node }
      updated.body = bodyCleaned
      changed = true
    }
    const contentCleaned = stripMarksFromBody(node.content)
    if (contentCleaned !== node.content) {
      if (updated === node) updated = { ...node }
      updated.content = contentCleaned
      changed = true
    }
    if (Array.isArray(node.children) && node.children.length) {
      const childrenCleaned = stripHighlightMarksFromOutlineNodes(node.children)
      if (childrenCleaned !== node.children) {
        if (updated === node) updated = { ...node }
        updated.children = childrenCleaned
        changed = true
      }
    }
    return updated
  })
  return changed ? next : nodes
}

export { HIGHLIGHT_MARK_TYPE }
