/**
 * Legacy API module - maintained for backward compatibility
 * All new code should import from './api/index.js' instead
 *
 * @deprecated Use './api/index.js' for new code
 */

// Re-export everything from the new API module
export {
  apiClient as api,
  API_ROOT,
  absoluteUrl,
  getOutline,
  saveOutline,
  saveOutlineApi,
  getTask,
  updateTask,
  getDays,
  uploadImage,
  listHistory,
  getVersionDoc,
  diffVersion,
  restoreVersion,
  createCheckpoint,
  getHealth
} from './api/index.js'

export {
  fetchExportManifest,
  importManifestFile
} from './api/index.js'
