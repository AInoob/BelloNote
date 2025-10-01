/**
 * Constants for the Timeline view
 */

/**
 * Regular expression to match date tokens in the format @YYYY-MM-DD
 */
export const DATE_RE = /@\d{4}-\d{2}-\d{2}\b/

/**
 * LocalStorage keys for timeline preferences
 */
export const TIMELINE_FUTURE_KEY = 'worklog.timeline.future'
export const TIMELINE_SOON_KEY = 'worklog.timeline.soon'
export const TIMELINE_FILTERS_KEY = 'worklog.timeline.filters'

/**
 * Duration for the focus flash animation (in milliseconds)
 */
export const FOCUS_FLASH_DURATION = 1200

/**
 * Debounce delay for timeline refresh (in milliseconds)
 */
export const REFRESH_DEBOUNCE_DELAY = 150

