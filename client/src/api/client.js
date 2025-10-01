/**
 * Axios client configuration for API requests
 */
import axios from 'axios'
import { API_ROOT, PLAYWRIGHT_TEST_HOSTS } from '../constants/config.js'

/**
 * Create default headers for API requests
 * Includes Playwright test detection header
 */
function createDefaultHeaders() {
  const headers = {}
  
  try {
    if (typeof window !== 'undefined') {
      const host = window.location?.host
      if (host && PLAYWRIGHT_TEST_HOSTS.has(host)) {
        headers['x-playwright-test'] = '1'
      }
    }
  } catch (error) {
    // Silently fail if window is not available
  }
  
  return headers
}

/**
 * Configured axios instance for API calls
 */
export const apiClient = axios.create({
  baseURL: `${API_ROOT}/api`,
  headers: createDefaultHeaders()
})

/**
 * Convert a relative path to an absolute URL
 * @param {string} path - The path to convert
 * @returns {string} The absolute URL
 */
export function absoluteUrl(path) {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  if (!API_ROOT) return path
  return path.startsWith('/') ? `${API_ROOT}${path}` : `${API_ROOT}/${path}`
}

