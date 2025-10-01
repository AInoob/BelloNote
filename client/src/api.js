import axios from 'axios'

const PLAYWRIGHT_HOSTS = new Set([
  '127.0.0.1:4173',
  'localhost:4173',
  '127.0.0.1:4175',
  'localhost:4175',
  '127.0.0.1:5232',
  'localhost:5232'
])

function normalizeApiRoot(rawValue) {
  const trimmed = (rawValue ?? '').trim()
  if (trimmed === '' || trimmed === '/') {
    return ''
  }
  return trimmed.replace(/\/$/, '')
}

function detectPlaywrightHeader() {
  const headers = {}

  try {
    if (typeof window === 'undefined') {
      return headers
    }

    const host = window?.location?.host
    const port = Number(window?.location?.port || host?.split(':')[1])
    const usePlaywrightHeader = host && PLAYWRIGHT_HOSTS.has(host)
    const isPlaywrightPort = Number.isFinite(port) && port >= 6000 && port <= 7999
    if (usePlaywrightHeader || isPlaywrightPort) {
      headers['x-playwright-test'] = '1'
      try {
        window.__PLAYWRIGHT_TEST__ = true
      } catch {}
    }
  } catch {
    // Ignore environment issues when window is not accessible
  }

  return headers
}

function buildApiBaseUrl(root) {
  return `${root}/api`
}

function isAbsoluteUrl(path) {
  return /^https?:\/\//i.test(path)
}

export const API_ROOT = normalizeApiRoot(import.meta.env.VITE_API_URL)
const defaultHeaders = detectPlaywrightHeader()

export const api = axios.create({
  baseURL: buildApiBaseUrl(API_ROOT),
  headers: defaultHeaders
})

export async function getOutline() {
  const { data } = await api.get('/outline')
  return data
}

export async function saveOutlineApi(outline) {
  const { data } = await api.post('/outline', { outline })
  return data
}

export async function getTask(id) {
  const { data } = await api.get(`/tasks/${id}`)
  return data
}

export async function updateTask(id, payload) {
  const { data } = await api.patch(`/tasks/${id}`, payload)
  return data
}

export async function getDays() {
  const { data } = await api.get('/day')
  return data
}

export async function uploadImage(file, filename) {
  const form = new FormData()
  const resolvedName = filename || (file && typeof file.name === 'string' ? file.name : null)

  if (resolvedName) {
    form.append('image', file, resolvedName)
  } else {
    form.append('image', file)
  }

  const { data } = await api.post('/upload/image', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })

  const rawUrl = typeof data.url === 'string' ? data.url : ''
  const relativeUrl = rawUrl.startsWith('/') ? rawUrl : rawUrl ? `/${rawUrl}` : ''
  const absoluteUrl = isAbsoluteUrl(relativeUrl)
    ? relativeUrl
    : `${API_ROOT}${relativeUrl}`

  return {
    url: absoluteUrl,
    relativeUrl: relativeUrl || absoluteUrl,
    id: data.id,
    mimeType: data.mimeType,
    size: data.size
  }
}

export async function listHistory(limit = 50, offset = 0) {
  const { data } = await api.get(`/history?limit=${limit}&offset=${offset}`)
  return data.items || []
}

export async function getVersionDoc(id) {
  const { data } = await api.get(`/history/${id}`)
  return data
}

export async function diffVersion(id, against = 'current') {
  const { data } = await api.get(`/history/${id}/diff?against=${against}`)
  return data
}

export async function restoreVersion(id) {
  const { data } = await api.post(`/history/${id}/restore`)
  return data
}

export async function createCheckpoint(note = '') {
  const { data } = await api.post('/history/checkpoint', { note })
  return data
}

export function absoluteUrl(path) {
  if (!path) {
    return path
  }

  if (isAbsoluteUrl(path)) {
    return path
  }

  if (!API_ROOT) {
    return path
  }

  return path.startsWith('/') ? `${API_ROOT}${path}` : `${API_ROOT}/${path}`
}

export async function getHealth() {
  const { data } = await api.get('/health')
  return data
}
