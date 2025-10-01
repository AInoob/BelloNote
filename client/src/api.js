import axios from 'axios'

// Configuration
const RAW_API_URL = (import.meta.env.VITE_API_URL ?? '').trim()
const API_ROOT_PATH = (RAW_API_URL === '/' || RAW_API_URL === '') ? '' : RAW_API_URL.replace(/\/$/, '')

export const API_ROOT = API_ROOT_PATH

// Playwright test detection
const PLAYWRIGHT_HOSTS = new Set([
  '127.0.0.1:4173',
  'localhost:4173',
  '127.0.0.1:4175',
  'localhost:4175',
  '127.0.0.1:5232',
  'localhost:5232'
])

/**
 * Detects if the current environment is a Playwright test
 * @returns {boolean} True if running in Playwright test environment
 */
function isPlaywrightTest() {
  try {
    if (typeof window !== 'undefined') {
      const host = window.location?.host
      return host && PLAYWRIGHT_HOSTS.has(host)
    }
  } catch {
    // Ignore errors
  }
  return false
}

// Setup default headers
const defaultHeaders = {}
if (isPlaywrightTest()) {
  defaultHeaders['x-playwright-test'] = '1'
}

// Create axios instance
export const api = axios.create({
  baseURL: `${API_ROOT}/api`,
  headers: defaultHeaders
})

// ============================================================================
// Outline API
// ============================================================================

/**
 * Fetches the outline document from the server
 * @returns {Promise<Object>} The outline data
 */
export async function getOutline() {
  const { data } = await api.get('/outline')
  return data
}

/**
 * Saves the outline document to the server
 * @param {Object} outline - The outline data to save
 * @returns {Promise<Object>} The server response
 */
export async function saveOutlineApi(outline) {
  const { data } = await api.post('/outline', { outline })
  return data
}

// ============================================================================
// Task API
// ============================================================================

/**
 * Fetches a specific task by ID
 * @param {string} id - The task ID
 * @returns {Promise<Object>} The task data
 */
export async function getTask(id) {
  const { data } = await api.get(`/tasks/${id}`)
  return data
}

/**
 * Updates a specific task
 * @param {string} id - The task ID
 * @param {Object} payload - The update payload
 * @returns {Promise<Object>} The updated task data
 */
export async function updateTask(id, payload) {
  const { data } = await api.patch(`/tasks/${id}`, payload)
  return data
}

// ============================================================================
// Timeline API
// ============================================================================

/**
 * Fetches the day timeline data
 * @returns {Promise<Object>} The timeline data
 */
export async function getDays() {
  const { data } = await api.get('/day')
  return data
}

// ============================================================================
// Upload API
// ============================================================================

/**
 * Uploads an image file to the server
 * @param {File} file - The image file to upload
 * @param {string} [filename] - Optional filename override
 * @returns {Promise<Object>} Upload result with url, relativeUrl, id, mimeType, and size
 */
export async function uploadImage(file, filename) {
  const form = new FormData()
  const name = filename || (file && typeof file.name === 'string' ? file.name : null)

  if (name) {
    form.append('image', file, name)
  } else {
    form.append('image', file)
  }

  const { data } = await api.post('/upload/image', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })

  const relRaw = typeof data.url === 'string' ? data.url : ''
  const relativeUrl = relRaw.startsWith('/') ? relRaw : (relRaw ? `/${relRaw}` : '')
  const isAbsolute = /^https?:\/\//i.test(relativeUrl)
  const absoluteUrl = isAbsolute ? relativeUrl : `${API_ROOT}${relativeUrl}`

  return {
    url: absoluteUrl,
    relativeUrl: relativeUrl || absoluteUrl,
    id: data.id,
    mimeType: data.mimeType,
    size: data.size
  }
}

// ============================================================================
// History API
// ============================================================================

/**
 * Lists history entries with pagination
 * @param {number} [limit=50] - Maximum number of entries to return
 * @param {number} [offset=0] - Number of entries to skip
 * @returns {Promise<Array>} Array of history items
 */
export async function listHistory(limit = 50, offset = 0) {
  const { data } = await api.get(`/history?limit=${limit}&offset=${offset}`)
  return data.items || []
}

/**
 * Gets a specific version document by ID
 * @param {string} id - The version ID
 * @returns {Promise<Object>} The version document
 */
export async function getVersionDoc(id) {
  const { data } = await api.get(`/history/${id}`)
  return data
}

/**
 * Gets the diff between a version and another version or current
 * @param {string} id - The version ID
 * @param {string} [against='current'] - What to compare against
 * @returns {Promise<Object>} The diff data
 */
export async function diffVersion(id, against = 'current') {
  const { data } = await api.get(`/history/${id}/diff?against=${against}`)
  return data
}

/**
 * Restores a specific version
 * @param {string} id - The version ID to restore
 * @returns {Promise<Object>} The restore result
 */
export async function restoreVersion(id) {
  const { data } = await api.post(`/history/${id}/restore`)
  return data
}

/**
 * Creates a manual checkpoint in history
 * @param {string} [note=''] - Optional note for the checkpoint
 * @returns {Promise<Object>} The checkpoint result
 */
export async function createCheckpoint(note = '') {
  const { data } = await api.post('/history/checkpoint', { note })
  return data
}

// ============================================================================
// Health API
// ============================================================================

/**
 * Checks the health status of the API
 * @returns {Promise<Object>} Health status data
 */
export async function getHealth() {
  const { data } = await api.get('/health')
  return data
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts a relative path to an absolute URL
 * @param {string} path - The path to convert
 * @returns {string} The absolute URL
 */
export function absoluteUrl(path) {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  if (!API_ROOT) return path
  return path.startsWith('/') ? `${API_ROOT}${path}` : `${API_ROOT}/${path}`
}
