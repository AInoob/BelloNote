import { STATUS_EMPTY } from './constants.js'
import { extractTitle, extractDates } from './listItemUtils.js'

/**
 * Normalize body nodes recursively
 * Note: This function is used with normalizeImageSrc callback
 * @param {Array} nodes - Array of body nodes
 * @param {Function} normalizeImageSrc - Function to normalize image src
 * @returns {Array} Normalized nodes
 */
export function normalizeBodyNodes(nodes, normalizeImageSrc) {
  return nodes.map(node => {
    const copy = { ...node }
    if (copy.type === 'image' && normalizeImageSrc) {
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
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? normalizeBodyNodes(parsed, normalizeImageSrc) : []
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

