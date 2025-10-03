/**
 * API service for health check operations
 */
import { apiClient } from '../client.js'

/**
 * Fetch server health status and build information
 * @returns {Promise<import('../../types.js').HealthStatus>} Health status with build time and version
 */
export async function getHealth() {
  const { data } = await apiClient.get('/health')
  return data
}

