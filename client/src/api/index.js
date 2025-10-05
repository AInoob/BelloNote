/**
 * Central API module - exports all API services
 * This provides a single entry point for all API operations
 */

// Re-export client utilities
export { apiClient, absoluteUrl } from './client.js'
export { API_ROOT } from '../constants/config.js'

// Re-export all service functions
export { getOutline, saveOutline } from './services/outlineService.js'
export { getTask, updateTask } from './services/taskService.js'
export { getDays } from './services/timelineService.js'
export { uploadImage } from './services/uploadService.js'
export {
  listHistory,
  getVersionDoc,
  diffVersion,
  restoreVersion,
  createCheckpoint
} from './services/historyService.js'
export { getHealth } from './services/healthService.js'
export { fetchExportManifest, importManifestFile } from './services/exportImportService.js'

// Legacy compatibility - keep old export name
export { saveOutline as saveOutlineApi } from './services/outlineService.js'
