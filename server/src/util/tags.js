const TAG_SCAN_RE = /(^|[^0-9A-Za-z_\/])#([a-zA-Z0-9][\w-]{0,63})\b/g

export function extractTagsFromString(text = '') {
  if (typeof text !== 'string' || !text) return []
  const seen = new Set()
  let match
  TAG_SCAN_RE.lastIndex = 0
  while ((match = TAG_SCAN_RE.exec(text)) !== null) {
    const raw = match[2]
    if (!raw) continue
    seen.add(raw.toLowerCase())
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

function collectTextFromNodes(nodes, out) {
  if (!Array.isArray(nodes)) return out
  nodes.forEach(node => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) collectTextFromNodes(node.content, out)
  })
  return out
}

export function extractTagsFromNodes(nodes) {
  const parts = collectTextFromNodes(nodes, [])
  if (!parts.length) return []
  return extractTagsFromString(parts.join(' '))
}

export function computeTaskTags({ title = '', nodes = null, html = '' } = {}) {
  const set = new Set()
  extractTagsFromString(title).forEach(tag => set.add(tag))
  if (Array.isArray(nodes)) {
    extractTagsFromNodes(nodes).forEach(tag => set.add(tag))
  } else if (typeof html === 'string' && html) {
    extractTagsFromString(html).forEach(tag => set.add(tag))
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function parseTagsField(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(v => String(v || '').toLowerCase()))).sort((a, b) => a.localeCompare(b))
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parseTagsField(parsed)
    } catch {}
  }
  return []
}
