/**
 * API service for timeline/day operations
 */
import { apiClient } from '../client.js'

/**
 * Fetch all timeline days with their associated tasks and events
 * @returns {Promise<import('../../types.js').TimelineData>} Timeline data with days array
 */
export async function getDays() {
  const { data } = await apiClient.get('/day')
  return data
}

