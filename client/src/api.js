
import axios from 'axios'

const RAW = (import.meta.env.VITE_API_URL ?? '').trim();
let apiRoot = (RAW === '/' || RAW === '') ? '' : RAW.replace(/\/$/, '');
export const API_ROOT = apiRoot;
const defaultHeaders = {}
const PLAYWRIGHT_HOSTS = new Set([
  '127.0.0.1:4173',
  'localhost:4173',
  '127.0.0.1:4175',
  'localhost:4175',
  '127.0.0.1:5232',
  'localhost:5232'
])

try {
  if (typeof window !== 'undefined') {
    const host = window.location && window.location.host
    if (host && PLAYWRIGHT_HOSTS.has(host)) {
      defaultHeaders['x-playwright-test'] = '1'
    }
  }
} catch {}
export const api = axios.create({ baseURL: `${API_ROOT}/api`, headers: defaultHeaders })

// Outline
export async function getOutline() { const { data } = await api.get('/outline'); return data }
export async function saveOutlineApi(outline) { const { data } = await api.post('/outline', { outline }); return data }

// Task details
export async function getTask(id) { const { data } = await api.get(`/tasks/${id}`); return data }
export async function updateTask(id, payload) { const { data } = await api.patch(`/tasks/${id}`, payload); return data }

// Day timeline
export async function getDays() { const { data } = await api.get('/day'); return data }

// Uploads
export async function uploadImage(file, filename) {
  const form = new FormData()
  const name = filename || (file && typeof file.name === 'string' ? file.name : null)
  if (name) form.append('image', file, name)
  else form.append('image', file)
  const { data } = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  const relRaw = typeof data.url === 'string' ? data.url : ''
  const relativeUrl = relRaw.startsWith('/') ? relRaw : (relRaw ? `/${relRaw}` : '')
  const abs = /^https?:\/\//i.test(relativeUrl)
    ? relativeUrl
    : `${API_ROOT}${relativeUrl}`
  return {
    url: abs,
    relativeUrl: relativeUrl || abs,
    id: data.id,
    mimeType: data.mimeType,
    size: data.size
  }
}

// History
export async function listHistory(limit=50, offset=0) { const { data } = await api.get(`/history?limit=${limit}&offset=${offset}`); return data.items || [] }
export async function getVersionDoc(id) { const { data } = await api.get(`/history/${id}`); return data }
export async function diffVersion(id, against='current') { const { data } = await api.get(`/history/${id}/diff?against=${against}`); return data }
export async function restoreVersion(id) { const { data } = await api.post(`/history/${id}/restore`); return data }
export async function createCheckpoint(note='') { const { data } = await api.post('/history/checkpoint', { note }); return data }

export function absoluteUrl(path) {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  if (!API_ROOT) return path
  return path.startsWith('/') ? `${API_ROOT}${path}` : `${API_ROOT}/${path}`
}

// Health
export async function getHealth() {
  const { data } = await api.get('/health')
  return data
}
