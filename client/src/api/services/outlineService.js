/**
 * API service for outline operations
 */
import { apiClient } from '../client.js'

/**
 * Fetch the current outline
 * @returns {Promise<Object>} The outline data
 */
export async function getOutline() {
  const { data } = await apiClient.get('/outline')
  return data
}

/**
 * Save the outline
 * @param {Object} outline - The outline data to save
 * @returns {Promise<Object>} The response data
 */
export async function saveOutline(outline) {
  const { data } = await apiClient.post('/outline', { outline })
  return data
}

