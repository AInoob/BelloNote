// ============================================================================
// Outliner Constants
// Shared constants for status, filters, tags, URLs, and localStorage keys
// ============================================================================

// ============================================================================
// Status Constants
// ============================================================================

/** Empty/no status value */
export const STATUS_EMPTY = ''

/** Order of statuses for cycling through states */
export const STATUS_ORDER = ['todo', 'in-progress', 'done', STATUS_EMPTY]

/** Icon characters for each status */
export const STATUS_ICON = {
  [STATUS_EMPTY]: '',
  todo: '○',
  'in-progress': '◐',
  done: '✓'
}

// ============================================================================
// Regex Patterns
// ============================================================================

/** Matches date tags in format @YYYY-MM-DD */
export const DATE_RE = /@\d{4}-\d{2}-\d{2}/g

/** Validates single tag value (alphanumeric, dash, underscore; 1-64 chars) */
export const TAG_VALUE_RE = /^[a-zA-Z0-9][\w-]{0,63}$/

/** Scans for hashtags in text (e.g., #tag-name) */
export const TAG_SCAN_RE = /(^|[^0-9A-Za-z_\/])#([a-zA-Z0-9][\w-]{0,63})\b/g

/** Matches URLs with protocol (http://, https://, etc.) */
export const URL_PROTOCOL_RE = /^[a-z][\w+.-]*:\/\//i

/** Matches domain-like strings (e.g., example.com/path) */
export const DOMAIN_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?:\/[\w#?=&%+@.\-]*)?$/i

// ============================================================================
// localStorage Keys
// ============================================================================

/** Key for collapsed state map */
export const COLLAPSED_KEY = 'worklog.collapsed'

/** Key for status filter preferences */
export const FILTER_STATUS_KEY = 'worklog.filter.status'

/** Key for archived items filter preference */
export const FILTER_ARCHIVED_KEY = 'worklog.filter.archived'

/** Key for future items filter preference */
export const FILTER_FUTURE_KEY = 'worklog.filter.future'

/** Key for soon items filter preference */
export const FILTER_SOON_KEY = 'worklog.filter.soon'

/** Key for scroll position state */
export const SCROLL_STATE_KEY = 'worklog.lastScroll'

/** Key for include tag filter */
export const FILTER_TAG_INCLUDE_KEY = 'worklog.filter.tags.include'

/** Key for exclude tag filter */
export const FILTER_TAG_EXCLUDE_KEY = 'worklog.filter.tags.exclude'

// ============================================================================
// UI Constants
// ============================================================================

/** Placeholder text for starter/empty outline */
export const STARTER_PLACEHOLDER_TITLE = 'Start here'
