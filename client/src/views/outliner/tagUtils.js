import { TAG_SCAN_RE, TAG_VALUE_RE } from './constants.js'

export function parseTagInput(value = '') {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (!TAG_VALUE_RE.test(withoutHash)) return null
  const canonical = withoutHash.toLowerCase()
  return { canonical, display: withoutHash }
}

export function extractTagsFromText(text = '') {
  if (typeof text !== 'string' || !text) return []
  const seen = new Map()
  TAG_SCAN_RE.lastIndex = 0
  let match
  while ((match = TAG_SCAN_RE.exec(text)) !== null) {
    const raw = match[2]
    if (!raw) continue
    const canonical = raw.toLowerCase()
    if (!seen.has(canonical)) seen.set(canonical, raw)
  }
  return Array.from(seen, ([canonical, display]) => ({ canonical, display }))
}
