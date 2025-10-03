export const STATUS_EMPTY = ''
export const STATUS_ORDER = ['todo', 'in-progress', 'done', STATUS_EMPTY]
export const STATUS_ICON = {
  [STATUS_EMPTY]: '',
  todo: '○',
  'in-progress': '◐',
  done: '✓'
}

export const DATE_RE = /@\d{4}-\d{2}-\d{2}/g

export const COLLAPSED_KEY = 'worklog.collapsed'
export const FILTER_STATUS_KEY = 'worklog.filter.status'
export const FILTER_ARCHIVED_KEY = 'worklog.filter.archived'
export const SCROLL_STATE_KEY = 'worklog.lastScroll'
export const STARTER_PLACEHOLDER_TITLE = 'Start here'

export const FILTER_TAG_INCLUDE_KEY = 'worklog.filter.tags.include'
export const FILTER_TAG_EXCLUDE_KEY = 'worklog.filter.tags.exclude'
export const TAG_VALUE_RE = /^[a-zA-Z0-9][\w-]{0,63}$/
export const TAG_SCAN_RE = /(^|[^0-9A-Za-z_\/])#([a-zA-Z0-9][\w-]{0,63})\b/g

export const URL_PROTOCOL_RE = /^[a-z][\w+.-]*:\/\//i
export const DOMAIN_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?:\/[\w#?=&%+@.\-]*)?$/i
