// ============================================================================
// Filter Preset Functions
// Functions for managing status filter presets
// ============================================================================

import { DEFAULT_STATUS_FILTER, saveStatusFilter } from './filterUtils.js'

export const availableFilters = [
  { key: 'none', label: 'No status' },
  { key: 'todo', label: 'To do' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'done', label: 'Done' }
]

export const toggleStatusFilter = (statusFilter, statusFilterRef, setStatusFilter, key) => {
  const updated = { ...statusFilter, [key]: !statusFilter[key] }
  const keys = Object.keys(DEFAULT_STATUS_FILTER)
  const anyEnabled = keys.some(k => updated[k])
  const next = anyEnabled ? updated : { ...DEFAULT_STATUS_FILTER, done: false }
  try { saveStatusFilter(next) } catch {}
  statusFilterRef.current = next
  setStatusFilter(next)
}

export const applyPresetFilter = (statusFilterRef, setStatusFilter, preset) => {
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
