/**
 * JSDoc type definitions for the application
 * This file contains no runtime code - only type definitions for documentation
 */

/**
 * @typedef {Object} HistoryCheckpoint
 * @property {string} id - Unique checkpoint identifier
 * @property {string} note - User-provided note for the checkpoint
 * @property {string} createdAt - ISO timestamp of creation
 * @property {Object} doc - Document snapshot at checkpoint time
 */

/**
 * @typedef {Object} HistoryItem
 * @property {string} id - Unique version identifier
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} [note] - Optional note for the version
 * @property {boolean} [isCheckpoint] - Whether this is a manual checkpoint
 */

/**
 * @typedef {Object} VersionDocument
 * @property {string} id - Version identifier
 * @property {Object} doc - Document content at this version
 * @property {string} createdAt - ISO timestamp
 */

/**
 * @typedef {Object} VersionDiff
 * @property {string} id - Version identifier
 * @property {Array<Object>} changes - List of changes between versions
 * @property {Object} [metadata] - Additional diff metadata
 */

/**
 * @typedef {Object} OutlineData
 * @property {Array<Object>} roots - Root-level outline items
 * @property {string} [updatedAt] - Last update timestamp
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Unique task identifier
 * @property {string} title - Task title
 * @property {string} [status] - Task status (e.g., 'todo', 'done')
 * @property {Array<string>} [tags] - Task tags
 * @property {string} [remindAt] - ISO timestamp for reminder
 */

/**
 * @typedef {Object} TimelineDay
 * @property {string} date - Date in YYYY-MM-DD format
 * @property {Array<Object>} items - Tasks/events for this day
 */

/**
 * @typedef {Object} TimelineData
 * @property {Array<TimelineDay>} days - Timeline days with events
 */

/**
 * @typedef {Object} HealthStatus
 * @property {string} status - Health status ('ok' or 'error')
 * @property {string} [buildTime] - Server build timestamp
 * @property {string} [version] - Server version
 */

/**
 * @typedef {Object} UploadResult
 * @property {string} url - URL of uploaded file
 * @property {string} [filename] - Original filename
 * @property {number} [size] - File size in bytes
 */

