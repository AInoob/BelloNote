/**
 * Debug logging utilities for the outliner
 */

/**
 * Check if debug logging is enabled
 * @returns {boolean} True if debug logging is enabled
 */
export const LOG_ON = () => (localStorage.getItem('WL_DEBUG') === '1')

/**
 * Log a debug message if debug logging is enabled
 * @param {...any} args - Arguments to log
 */
export const LOG = (...args) => { 
  if (LOG_ON()) console.log('[slash]', ...args) 
}

