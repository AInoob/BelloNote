/**
 * API service for history and checkpoint operations
 */
import { apiClient } from '../client.js'
import { DEFAULT_HISTORY_LIMIT, DEFAULT_HISTORY_OFFSET } from '../../constants/config.js'

/**
 * List history entries
 * @param {number} [limit=50] - Maximum number of entries to return
 * @param {number} [offset=0] - Offset for pagination
 * @returns {Promise<Array>} Array of history items
 */
export async function listHistory(limit = DEFAULT_HISTORY_LIMIT, offset = DEFAULT_HISTORY_OFFSET) {
  const { data } = await apiClient.get(`/history?limit=${limit}&offset=${offset}`)
  return data.items || []
}

/**
 * Get a specific version document
 * @param {string} id - The version ID
 * @returns {Promise<Object>} The version document
 */
export async function getVersionDoc(id) {
  const { data } = await apiClient.get(`/history/${id}`)
  return data
}

/**
 * Get diff between versions
 * @param {string} id - The version ID
 * @param {string} [against='current'] - Version to compare against
 * @returns {Promise<Object>} The diff data
 */
export async function diffVersion(id, against = 'current') {
  const { data } = await apiClient.get(`/history/${id}/diff?against=${against}`)
  return data
}

/**
 * Restore a specific version
 * @param {string} id - The version ID to restore
 * @returns {Promise<Object>} The restore result
 */
export async function restoreVersion(id) {
  const { data } = await apiClient.post(`/history/${id}/restore`)
  return data
}

/**
 * Create a checkpoint with an optional note
 * @param {string} [note=''] - Optional note for the checkpoint
 * @returns {Promise<Object>} The checkpoint result
 */
export async function createCheckpoint(note = '') {
  const { data } = await apiClient.post('/history/checkpoint', { note })
  return data
}

