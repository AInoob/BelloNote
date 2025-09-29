import { DOMAIN_LIKE_RE, URL_PROTOCOL_RE } from './constants.js'

export function isLikelyUrl(value = '') {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (URL_PROTOCOL_RE.test(trimmed)) {
    try {
      new URL(trimmed)
      return true
    } catch {
      return false
    }
  }
  return DOMAIN_LIKE_RE.test(trimmed)
}

export function normalizeUrl(value = '') {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (URL_PROTOCOL_RE.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export function escapeForRegex(value = '') {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}
