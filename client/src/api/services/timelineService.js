/**
 * API service for timeline/day operations
 */
import { apiClient } from '../client.js'

/**
 * Get all days with their tasks
 * @returns {Promise<Object>} The days data
 */
export async function getDays() {
  const { data } = await apiClient.get('/day')
  return data
}

