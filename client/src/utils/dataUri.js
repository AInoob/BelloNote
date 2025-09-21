const DATA_URI_RE = /^data:([^;]+);base64,(.*)$/i

const EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv'
}

export function isDataUri(value) {
  return DATA_URI_RE.test(String(value || ''))
}

export function extensionFromMime(mime) {
  const lower = String(mime || '').toLowerCase()
  return EXTENSION_MAP[lower] || lower.split('/').pop() || 'bin'
}

export function dataUriToFilePayload(dataUri, prefix = 'pasted') {
  const match = DATA_URI_RE.exec(dataUri || '')
  if (!match) return null
  const mimeType = match[1]
  const base64 = match[2]
  try {
    const binary = atob(base64)
    const length = binary.length
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: mimeType })
    const ext = extensionFromMime(mimeType)
    const name = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`
    const file = typeof File === 'function' ? new File([blob], name, { type: mimeType }) : blob
    return { file, name, mimeType, extension: ext }
  } catch (err) {
    console.error('[dataUri] failed to decode', err)
    return null
  }
}
