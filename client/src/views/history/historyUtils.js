/**
 * Utility functions for grouping and organizing history items
 */

import { parseTimestamp, formatDayLabel } from './dateUtils.js'

/**
 * Group history rows by day
 * 
 * @param {Array} rows - Array of history items with created_at timestamps
 * @returns {Array} Array of day groups, each with key, label, and items
 */
export function groupHistory(rows) {
  const byDay = new Map()
  
  rows.forEach(row => {
    const date = parseTimestamp(row.created_at)
    if (!date) return
    
    const dayKey = date.toISOString().slice(0, 10)
    
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, {
        key: dayKey,
        label: formatDayLabel(date),
        items: []
      })
    }
    
    byDay.get(dayKey).items.push(row)
  })
  
  const groups = Array.from(byDay.values())
  
  // Sort items within each group by timestamp (newest first)
  groups.forEach(group => {
    group.items.sort((a, b) => {
      const da = parseTimestamp(a.created_at)
      const db = parseTimestamp(b.created_at)
      return (db?.getTime() || 0) - (da?.getTime() || 0)
    })
  })
  
  // Sort groups by day (newest first)
  groups.sort((a, b) => (a.key > b.key ? -1 : (a.key < b.key ? 1 : 0)))
  
  return groups
}

