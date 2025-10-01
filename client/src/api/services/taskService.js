/**
 * API service for task operations
 */
import { apiClient } from '../client.js'

/**
 * Get a specific task by ID
 * @param {string} id - The task ID
 * @returns {Promise<Object>} The task data
 */
export async function getTask(id) {
  const { data } = await apiClient.get(`/tasks/${id}`)
  return data
}

/**
 * Update a task
 * @param {string} id - The task ID
 * @param {Object} payload - The update payload
 * @returns {Promise<Object>} The updated task data
 */
export async function updateTask(id, payload) {
  const { data } = await apiClient.patch(`/tasks/${id}`, payload)
  return data
}

