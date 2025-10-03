/**
 * Normalize body nodes recursively
 * Note: This function is used with normalizeImageSrc callback
 * @param {Array} nodes - Array of body nodes
 * @param {Function} normalizeImageSrc - Function to normalize image src
 * @returns {Array} Normalized nodes
 */
export function normalizeBodyNodes(nodes, normalizeImageSrc) {
  if (!Array.isArray(nodes) || !nodes.length) return Array.isArray(nodes) ? nodes : []
  if (!normalizeImageSrc) return nodes
  return nodes.map(node => {
    const copy = { ...node }
    if (copy.type === 'image') {
      copy.attrs = { ...copy.attrs, src: normalizeImageSrc(copy.attrs?.src) }
    }
    if (copy.content) copy.content = normalizeBodyNodes(copy.content, normalizeImageSrc)
    return copy
  })
}

/**
 * Parse body content from raw data
 * @param {*} raw - Raw body content (string or array)
 * @param {Function} normalizeImageSrc - Function to normalize image src
 * @returns {Array} Parsed body nodes
 */
export function parseBodyContent(raw, normalizeImageSrc) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return normalizeImageSrc ? normalizeBodyNodes(raw, normalizeImageSrc) : raw
  }
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? (normalizeImageSrc ? normalizeBodyNodes(parsed, normalizeImageSrc) : parsed)
      : []
  } catch {
    return []
  }
}

/**
 * Create default body content for a task
 * @param {string} titleText - Task title
 * @param {Array} dateTokens - Array of date tokens
 * @param {boolean} hasExtras - Whether the body has extra content
 * @returns {Array} Default body nodes
 */
export function defaultBody(titleText, dateTokens, hasExtras) {
  if (!hasExtras && (!dateTokens || !dateTokens.length)) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
  }
  const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
  if (dateTokens?.length) {
    textContent.push({ type: 'text', text: ' ' + dateTokens.map(d => '@' + d).join(' ') })
  }
  return [{ type: 'paragraph', content: textContent }]
}
