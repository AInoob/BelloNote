/**
 * Performance and timing utilities for the outliner
 */

/**
 * Get the current timestamp using performance.now() if available, otherwise Date.now()
 * @returns {number} Current timestamp in milliseconds
 */
export function now() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function') 
    ? performance.now() 
    : Date.now()
}

/**
 * Log cursor timing information for debugging
 * @param {string} label - Label for the timing log
 * @param {number} startedAt - Start timestamp
 */
export function logCursorTiming(label, startedAt) {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') return
  const elapsed = performance.now() - startedAt
  if (elapsed > 100) {
    console.warn(`[cursor-timing] ${label} took ${elapsed.toFixed(1)}ms`)
  }
}

