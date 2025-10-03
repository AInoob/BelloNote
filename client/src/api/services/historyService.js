/**
 * API service for history and checkpoint operations
 */
import { apiClient } from '../client.js'
import { DEFAULT_HISTORY_LIMIT, DEFAULT_HISTORY_OFFSET } from '../../constants/config.js'

/**
 * Fetch paginated list of history entries
 * @param {number} [limit=50] - Maximum number of entries to return
 * @param {number} [offset=0] - Offset for pagination
 * @returns {Promise<Array<import('../../types.js').HistoryItem>>} Array of history items
 */
export async function listHistory(limit = DEFAULT_HISTORY_LIMIT, offset = DEFAULT_HISTORY_OFFSET) {
  const { data } = await apiClient.get(`/history?limit=${limit}&offset=${offset}`)
  return data.items || []
}

/**
 * Fetch a specific version document by ID
 * @param {string} id - The version ID
 * @returns {Promise<import('../../types.js').VersionDocument>} The version document with content
 */
export async function getVersionDoc(id) {
  const { data } = await apiClient.get(`/history/${id}`)
  return data
}

/**
 * Get diff between two versions
 * @param {string} id - The version ID to compare
 * @param {string} [against='current'] - Version to compare against (default: current)
 * @returns {Promise<import('../../types.js').VersionDiff>} The diff data with changes
 */
export async function diffVersion(id, against = 'current') {
  const { data } = await apiClient.get(`/history/${id}/diff?against=${against}`)
  return data
}

/**
 * Restore the outline to a specific version
 * @param {string} id - The version ID to restore
 * @returns {Promise<{success: boolean}>} The restore result
 */
export async function restoreVersion(id) {
  const { data } = await apiClient.post(`/history/${id}/restore`)
  return data
}

/**
 * Create a manual checkpoint with an optional note
 * @param {string} [note=''] - Optional note describing the checkpoint
 * @returns {Promise<import('../../types.js').HistoryCheckpoint>} The created checkpoint
 */
export async function createCheckpoint(note = '') {
  const { data } = await apiClient.post('/history/checkpoint', { note })
  return data
}

