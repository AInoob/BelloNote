import { storeDataUri, isDataUri } from './files.js'

const FILE_PATH_RE = /^https?:\/\/[^/]+(\/files\/[^\s?#]+)$/i

function extractFilePath(value) {
  if (!value) return null
  if (value.startsWith('/files/')) return value
  const match = FILE_PATH_RE.exec(value)
  if (match) return match[1]
  return null
}

function extractFileId(path) {
  if (!path) return null
  const parts = path.split('/')
  if (parts.length >= 3) {
    const id = Number(parts[2])
    if (Number.isInteger(id) && id > 0) return String(id)
  }
  return null
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') return { ...value }
  return value
}

function sanitizeNode(node, projectId, context = {}) {
  if (!node || typeof node !== 'object') return node
  const copy = { ...node }
  if (copy.attrs) copy.attrs = { ...copy.attrs }

  if (copy.type === 'image') {
    const attrs = copy.attrs || {}
    if (attrs.src && isDataUri(attrs.src)) {
      const stored = storeDataUri(attrs.src, { projectId, originalName: attrs?.name || attrs?.alt || context.title })
      if (stored) {
        attrs.src = stored.url
        if (stored.url) attrs['data-file-path'] = stored.url
        if (stored.id) attrs['data-file-id'] = String(stored.id)
      }
    } else {
      const explicitPath = typeof attrs['data-file-path'] === 'string' ? attrs['data-file-path'] : null
      const relative = explicitPath || extractFilePath(attrs.src)
      if (relative) {
        attrs.src = relative
        attrs['data-file-path'] = relative
        const fileId = attrs['data-file-id'] || extractFileId(relative)
        if (fileId) attrs['data-file-id'] = fileId
      }
    }
  }

  if (Array.isArray(copy.content)) {
    copy.content = copy.content.map(child => sanitizeNode(child, projectId, context))
  }
  return copy
}

export function sanitizeRichText(nodes, projectId, context = {}) {
  if (!Array.isArray(nodes)) return []
  return nodes.map(node => sanitizeNode(node, projectId, context))
}

export function parseMaybeJson(value) {
  if (!value) return []
  if (Array.isArray(value)) return clone(value)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function stringifyNodes(nodes) {
  try {
    return JSON.stringify(nodes || [])
  } catch {
    return '[]'
  }
}

const IMG_SRC_DATA_RE = /(<img\b[^>]*?\s)src=(['"])(data:[^'"\s>]+)\2/gi

export function sanitizeHtmlContent(html, projectId) {
  if (typeof html !== 'string' || !html) return html
  return html.replace(IMG_SRC_DATA_RE, (full, prefix, quote, dataUri) => {
    const stored = storeDataUri(dataUri, { projectId })
    if (!stored) return full
    const attrs = []
    if (stored?.id) attrs.push(`data-file-id="${stored.id}"`)
    if (stored?.url) attrs.push(`data-file-path="${stored.url}"`)
    const prefixWithoutAttr = prefix
      .replace(/\sdata-file-id=("[^"]*"|'[^']*')/i, ' ')
      .replace(/\sdata-file-path=("[^"]*"|'[^']*')/i, ' ')
    const attrString = attrs.length ? ` ${attrs.join(' ')}` : ''
    return `${prefixWithoutAttr}src=${quote}${stored.url}${quote}${attrString}`
  })
}
