/**
 * Axios client configuration for API requests
 */
import axios from 'axios'
import { API_ROOT, PLAYWRIGHT_TEST_HOSTS } from '../constants/config.js'

/**
 * Detect if the client is running in a Playwright test environment
 * @param {Set<string>} hostsSet - Set of known test hosts
 * @returns {boolean} True if running in Playwright test environment
 */
function isPlaywrightClient(hostsSet) {
  try {
    const { hostname, port } = window.location
    const portNum = Number(port || 0)
    const hostMatch = hostsSet?.has?.(hostname) || /\bplaywright\b/i.test(hostname)
    const portMatch = Number.isFinite(portNum) && portNum >= 6000 && portNum <= 7999
    const envMatch = (import.meta?.env?.VITE_E2E === '1')
    return hostMatch || portMatch || envMatch
  } catch {
    return false
  }
}

/**
 * Create default headers for API requests
 * Includes Playwright test detection header
 */
function createDefaultHeaders() {
  const headers = {}

  if (isPlaywrightClient(PLAYWRIGHT_TEST_HOSTS)) {
    headers['x-playwright-test'] = '1'
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

