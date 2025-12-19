const MARKDOWN_INDENT_UNIT = '  '
const TEXT_INDENT_UNIT = '  '
const NBSP = '\u00A0'

function indent(depth, unit) {
  if (!depth || depth <= 0) return ''
  return unit.repeat(depth)
}

function getLinkHref(marks = []) {
  if (!Array.isArray(marks)) return null
  const mark = marks.find(m => m?.type?.name === 'link' && m?.attrs?.href)
  return mark?.attrs?.href ? String(mark.attrs.href) : null
}

function inlineNodeToText(node, { format }) {
  if (!node) return ''
  const typeName = node.type?.name || ''
  if (typeName === 'text') {
    const text = node.text || ''
    if (format === 'markdown') {
      const href = getLinkHref(node.marks)
      if (href) return `[${text}](${href})`
    }
    return text
  }
  if (typeName === 'hardBreak') return '\n'
  if (typeName === 'image') {
    const src = node.attrs?.src ? String(node.attrs.src) : ''
    const alt = node.attrs?.alt ? String(node.attrs.alt) : 'image'
    if (!src) return alt
    return format === 'markdown' ? `![${alt}](${src})` : src
  }
  if (node.isText && typeof node.text === 'string') return node.text
  if (node.content?.size) {
    let out = ''
    node.content.forEach((child) => {
      out += inlineNodeToText(child, { format })
    })
    return out
  }
  return ''
}

function paragraphToLines(node, { format }) {
  const raw = inlineNodeToText(node, { format })
  if (!raw) return ['']
  const lines = raw.split('\n')
  return lines.length ? lines : ['']
}

function codeBlockToLines(node, { format }) {
  const code = node?.textContent ? String(node.textContent) : ''
  const lines = code.split('\n')
  if (format === 'markdown') {
    return ['```', ...lines, '```']
  }
  return lines.length ? lines : ['']
}

function blockNodeToLines(node, { format }) {
  const typeName = node?.type?.name || ''
  if (typeName === 'paragraph') return paragraphToLines(node, { format })
  if (typeName === 'codeBlock') return codeBlockToLines(node, { format })
  if (node?.isTextblock) {
    const text = node.textContent ? String(node.textContent) : ''
    return text ? [text] : ['']
  }
  const text = node?.textContent ? String(node.textContent) : ''
  return text ? [text] : ['']
}

function listItemStatusPrefix(node, { format }) {
  const status = node?.attrs?.status ? String(node.attrs.status) : ''
  if (!status) return ''
  if (format === 'markdown') {
    if (status === 'todo') return '[ ] '
    if (status === 'done') return '[x] '
    if (status === 'in-progress') return '[-] '
    return ''
  }
  return ''
}

function selectionIntersectsOwnListItemContent(listItemNode, listItemPos, from, to) {
  if (!listItemNode || listItemNode.type?.name !== 'listItem') return false
  if (typeof listItemPos !== 'number') return false
  const startBase = listItemPos + 1
  let cursor = startBase
  for (let i = 0; i < listItemNode.childCount; i += 1) {
    const child = listItemNode.child(i)
    const childStart = cursor
    const childEnd = cursor + child.nodeSize
    cursor = childEnd
    const typeName = child?.type?.name || ''
    if (typeName === 'bulletList' || typeName === 'orderedList') continue
    const intersects = !(childEnd <= from || childStart >= to)
    if (intersects) return true
  }
  return false
}

function listItemToLines(node, depth, { format }) {
  const children = []
  const nestedLists = []
  node.content?.forEach((child) => {
    const t = child?.type?.name || ''
    if (t === 'bulletList' || t === 'orderedList') nestedLists.push(child)
    else children.push(child)
  })

  const bodyLines = []
  for (const child of children) {
    const lines = blockNodeToLines(child, { format })
    for (const line of lines) bodyLines.push(line)
  }

  const indentUnit = format === 'markdown' ? MARKDOWN_INDENT_UNIT : TEXT_INDENT_UNIT
  const ownIndent = indent(depth, indentUnit)
  const bulletPrefix = `${ownIndent}- `
  const statusPrefix = listItemStatusPrefix(node, { format })
  const first = bodyLines.length ? (bodyLines[0] || '') : ''
  const result = [`${bulletPrefix}${statusPrefix}${first}`]

  // Continuation lines should align with the content start column (after "- " and any status prefix).
  const continuationIndent = `${ownIndent}${' '.repeat(2 + statusPrefix.length)}`
  for (let i = 1; i < bodyLines.length; i += 1) {
    result.push(`${continuationIndent}${bodyLines[i] || ''}`)
  }

  for (const nested of nestedLists) {
    result.push(...serializeNodes(nested.content, depth + 1, { format }))
  }

  return result
}

function bulletListToLines(node, depth, { format }) {
  const lines = []
  node.content?.forEach((child) => {
    if (child?.type?.name !== 'listItem') return
    lines.push(...listItemToLines(child, depth, { format }))
  })
  return lines
}

function serializeNodes(fragment, depth, { format }) {
  const lines = []
  if (!fragment) return lines
  fragment.forEach((node) => {
    const typeName = node?.type?.name || ''
    if (typeName === 'bulletList') {
      lines.push(...bulletListToLines(node, depth, { format }))
      return
    }
    if (typeName === 'listItem') {
      lines.push(...listItemToLines(node, depth, { format }))
      return
    }
    if (typeName === 'paragraph') {
      lines.push(...paragraphToLines(node, { format }))
      return
    }
    if (typeName === 'codeBlock') {
      lines.push(...codeBlockToLines(node, { format }))
      return
    }
    if (node?.isTextblock) {
      const text = node.textContent ? String(node.textContent) : ''
      lines.push(text)
      return
    }
    if (node?.content?.size) {
      lines.push(...serializeNodes(node.content, depth, { format }))
      return
    }
    const text = node?.textContent ? String(node.textContent) : ''
    if (text) lines.push(text)
  })
  return lines
}

export function formatEditorSelection(state, { format = 'text' } = {}) {
  if (!state?.selection) return ''
  if (state.selection.empty) return ''
  const { selection, doc } = state
  if (!doc) return ''

  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)

  // Collect listItems that intersect the selection. If an ancestor listItem is selected,
  // skip its descendants to avoid duplication (the ancestor already includes them).
  const candidates = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node?.type?.name !== 'listItem') return undefined
    const start = pos
    const end = pos + node.nodeSize
    const intersects = !(end <= from || start >= to)
    if (!intersects) return undefined
    // Important: if the selection only touches this listItem through its nested children (e.g. a
    // sub-task node selection), we do NOT want to include the ancestor. Require an intersection
    // with the listItem's own content (paragraph/code/etc), excluding nested bullet lists.
    if (!selectionIntersectsOwnListItemContent(node, pos, from, to)) return undefined
    candidates.push({ node, pos, depth: null, ancestorPos: null })
    return undefined
  })

  // If we didn't capture any list items (rare), fall back to plain selected text.
  if (!candidates.length) {
    const slice = selection.content()
    const lines = serializeNodes(slice.content, 0, { format })
    const joined = lines.join('\n').replace(/\s+\n/g, '\n').trimEnd()
    return joined
  }

  const listItemPositions = new Set(candidates.map(c => c.pos))
  for (const entry of candidates) {
    const resolved = doc.resolve(entry.pos + 1)
    // Count listItem ancestors (including itself) to get absolute nesting level.
    let depthCount = 0
    let ancestorPos = null
    for (let d = resolved.depth; d >= 0; d -= 1) {
      const n = resolved.node(d)
      if (n?.type?.name !== 'listItem') continue
      depthCount += 1
      const before = resolved.before(d)
      // The first ancestor encountered is the entry itself; later ones are parents.
      if (before !== entry.pos && listItemPositions.has(before)) {
        ancestorPos = before
        break
      }
    }
    entry.depth = Math.max(0, depthCount - 1)
    entry.ancestorPos = ancestorPos
  }

  const topLevel = candidates.filter(c => !c.ancestorPos)
  const baseDepth = topLevel.reduce((min, c) => Math.min(min, c.depth ?? 0), Infinity)

  const lines = []
  for (const item of topLevel) {
    const relativeDepth = Math.max(0, (item.depth ?? 0) - (Number.isFinite(baseDepth) ? baseDepth : 0))
    lines.push(...listItemToLines(item.node, relativeDepth, { format }))
  }

  let joined = lines.join('\n').replace(/\s+\n/g, '\n').trimEnd()

  // For plain text, use NBSP for leading indentation so apps like Slack don't collapse it.
  if (format === 'text') {
    joined = joined.replace(/^( +)/gm, (m) => NBSP.repeat(m.length))
  }

  return joined
}


