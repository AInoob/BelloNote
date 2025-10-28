/**
 * Application configuration constants
 */

// API Configuration
const runtimeApiUrl = typeof window !== 'undefined' 
  && window.__BELLO_RUNTIME_CONFIG__ 
  && typeof window.__BELLO_RUNTIME_CONFIG__.apiUrl === 'string'
  ? window.__BELLO_RUNTIME_CONFIG__.apiUrl
  : null

export const API_URL_RAW = (runtimeApiUrl ?? import.meta.env.VITE_API_URL ?? '').trim()
export const API_ROOT = (API_URL_RAW === '/' || API_URL_RAW === '') 
  ? '' 
  : API_URL_RAW.replace(/\/$/, '')

// Playwright test detection
export const PLAYWRIGHT_TEST_HOSTS = new Set([
  '127.0.0.1:4173',
  'localhost:4173',
  '127.0.0.1:4175',
  'localhost:4175',
  '127.0.0.1:5232',
  'localhost:5232'
])

// Build time
export const CLIENT_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' 
  ? __APP_BUILD_TIME__ 
  : null

export const APP_NAME = 'Bello Note'
export const APP_VERSION = '0.1.0'

// Tab identifiers
export const TAB_IDS = {
  OUTLINE: 'outline',
  TIMELINE: 'timeline'
}

// Default values
export const DEFAULT_HISTORY_LIMIT = 50
export const DEFAULT_HISTORY_OFFSET = 0

// Reminder polling interval (30 seconds)
export const REMINDER_POLL_INTERVAL_MS = 30_000
