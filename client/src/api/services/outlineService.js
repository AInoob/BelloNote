/**
 * API service for outline operations
 */
import { apiClient } from '../client.js'

/**
 * Fetch the current outline document
 * @param {{ signal?: AbortSignal }} [options] - Optional request options
 * @returns {Promise<import('../../types.js').OutlineData>} The outline data with roots
 */
export async function getOutline(options = {}) {
  const { signal } = options || {}
  const { data } = await apiClient.get('/outline', { signal })
  return data
}

/**
 * Save the outline document to the server
 * @param {import('../../types.js').OutlineData} outline - The outline data to save
 * @returns {Promise<{success: boolean}>} Response indicating save success
 */
export async function saveOutline(outline) {
  const { data } = await apiClient.post('/outline', { outline })
  return data
}
