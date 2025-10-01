const PLAYWRIGHT_USER_AGENT_RE = /Playwright/i
const PLAYWRIGHT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

export function isPlaywrightTestEnvironment() {
  if (typeof window !== 'undefined' && window.__PLAYWRIGHT_TEST__ === true) {
    return true
  }
  if (typeof navigator !== 'undefined' && PLAYWRIGHT_USER_AGENT_RE.test(navigator.userAgent || '')) {
    return true
  }
  return false
}

export function applyPlaywrightImageFallback(src) {
  if (!src) return src
  if (!isPlaywrightTestEnvironment()) return src
  if (!/^https?:\/\//i.test(src)) return src
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    const url = new URL(src, base)
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : null
    if (url.origin === currentOrigin) {
      return src
    }
  } catch {
    // If URL parsing fails in Playwright, fall back to placeholder to avoid network noise
  }
  return PLAYWRIGHT_IMAGE_PLACEHOLDER
}

export function sanitizeNodeImages(node) {
  if (!isPlaywrightTestEnvironment()) return node
  return cloneWithImageFallback(node)
}

function cloneWithImageFallback(value) {
  if (Array.isArray(value)) {
    return value.map(cloneWithImageFallback)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const result = { ...value }

  if (result.attrs?.src) {
    result.attrs = { ...result.attrs, src: applyPlaywrightImageFallback(result.attrs.src) }
  }

  if (Array.isArray(result.content)) {
    result.content = result.content.map(cloneWithImageFallback)
  }

  if (Array.isArray(result.children)) {
    result.children = result.children.map(cloneWithImageFallback)
  }

  if (Array.isArray(result.body)) {
    result.body = result.body.map(cloneWithImageFallback)
  }

  return result
}
