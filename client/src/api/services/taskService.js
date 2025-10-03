/**
 * API service for task operations
 */
import { apiClient } from '../client.js'

/**
 * Fetch a specific task by its unique identifier
 * @param {string} id - The task ID
 * @returns {Promise<import('../../types.js').Task>} The task data
 */
export async function getTask(id) {
  const { data } = await apiClient.get(`/tasks/${id}`)
  return data
}

/**
 * Update an existing task with new data
 * @param {string} id - The task ID
 * @param {Partial<import('../../types.js').Task>} payload - Fields to update
 * @returns {Promise<import('../../types.js').Task>} The updated task data
 */
export async function updateTask(id, payload) {
  const { data } = await apiClient.patch(`/tasks/${id}`, payload)
  return data
}

