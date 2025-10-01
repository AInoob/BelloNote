/**
 * API service for health check operations
 */
import { apiClient } from '../client.js'

/**
 * Get server health status
 * @returns {Promise<Object>} The health status data
 */
export async function getHealth() {
  const { data } = await apiClient.get('/health')
  return data
}

