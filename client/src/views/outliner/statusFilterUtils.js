import { DEFAULT_STATUS_FILTER } from './filterPreferences.js'
import { saveStatusFilter } from './filterPreferences.js'

/**
 * Available status filter options
 */
export const AVAILABLE_FILTERS = [
  { key: 'none', label: 'No status' },
  { key: 'todo', label: 'To do' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'done', label: 'Done' }
]

/**
 * Toggle a status filter key
 * @param {Object} statusFilter - Current status filter
 * @param {string} key - Filter key to toggle
 * @param {Function} setStatusFilter - State setter for status filter
 * @param {Object} statusFilterRef - Ref to status filter
 * @returns {Object} Updated status filter
 */
export function toggleStatusFilter(statusFilter, key, setStatusFilter, statusFilterRef) {
  const updated = { ...statusFilter, [key]: !statusFilter[key] }
  const keys = Object.keys(DEFAULT_STATUS_FILTER)
  const anyEnabled = keys.some(k => updated[k])
  const next = anyEnabled ? updated : { ...DEFAULT_STATUS_FILTER, done: false }
  try { saveStatusFilter(next) } catch {}
  statusFilterRef.current = next
  setStatusFilter(next)
  return next
}

/**
 * Apply a preset filter (all, active, completed)
 * @param {string} preset - Preset name ('all', 'active', 'completed')
 * @param {Function} setStatusFilter - State setter for status filter
 * @param {Object} statusFilterRef - Ref to status filter
 */
export function applyPresetFilter(preset, setStatusFilter, statusFilterRef) {
  if (preset === 'all') {
    const next = { ...DEFAULT_STATUS_FILTER }
    statusFilterRef.current = next
    setStatusFilter(next)
  } else if (preset === 'active') {
    const next = { none: true, todo: true, 'in-progress': true, done: false }
    statusFilterRef.current = next
    setStatusFilter(next)
  } else if (preset === 'completed') {
    const next = { none: false, todo: false, 'in-progress': false, done: true }
    statusFilterRef.current = next
    setStatusFilter(next)
  }
}

