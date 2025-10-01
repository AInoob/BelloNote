// ============================================================================
// Active Task Tracking Hook
// React hook for tracking the currently active/selected task in the editor
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import { parseReminderTokenFromText } from '../../utils/reminderTokens.js'

/**
 * Custom hook for tracking the currently active task based on cursor position
 * Notifies parent component when the active task changes
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {Function} params.onActiveTaskChange - Callback when active task changes
 * @returns {Object} Active task utilities
 */
export function useActiveTask({ editor, onActiveTaskChange }) {
  const activeTaskInfoRef = useRef(null) // Info about currently active task

  /**
   * Computes information about the currently active task (based on cursor position)
   * Returns task ID, reminder status, and dates for syncing with Timeline view
   * @returns {Object|null} Object with id, hasReminder, hasDate, dates, reminderDate, remindAt
   */
  const computeActiveTask = useCallback(() => {
    if (!editor) return null
    try {
      const { state } = editor
      if (!state) return null
      const { $from } = state.selection

      // Walk up the document tree to find the nearest list item ancestor
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const node = $from.node(depth)
        if (!node || node.type?.name !== 'listItem') continue

        // Extract task ID, reminder, and date information
        const dataId = node.attrs?.dataId ? String(node.attrs.dataId) : null
        const reminder = parseReminderTokenFromText(node.textContent || '')
        const textContent = node.textContent || ''
        const dateMatches = textContent.match(/@\d{4}-\d{2}-\d{2}/g) || []
        const dates = Array.from(new Set(dateMatches.map(item => item.slice(1)))) // Remove @ prefix
        const hasDate = dates.length > 0
        const hasReminder = !!reminder
        const reminderDate = reminder?.remindAt ? dayjs(reminder.remindAt).format('YYYY-MM-DD') : null

        return {
          id: dataId,
          hasReminder,
          hasDate,
          dates,
          reminderDate,
          remindAt: reminder?.remindAt || null
        }
      }
    } catch {
      return null
    }
    return null
  }, [editor])

  // Notify parent component when active task changes (for Timeline sync)
  useEffect(() => {
    if (!editor) return undefined

    const notify = () => {
      const info = computeActiveTask()
      const prev = activeTaskInfoRef.current

      // Build comparison keys to detect changes
      const prevKey = prev ? `${prev.id}|${prev.hasReminder}|${prev.hasDate}|${prev.reminderDate}|${(prev.dates || []).join(',')}` : ''
      const nextKey = info ? `${info.id}|${info.hasReminder}|${info.hasDate}|${info.reminderDate}|${(info.dates || []).join(',')}` : ''

      if (prevKey === nextKey) return // No change, skip notification

      activeTaskInfoRef.current = info
      onActiveTaskChange?.(info)
    }

    notify() // Notify on mount
    editor.on('selectionUpdate', notify)
    editor.on('transaction', notify)

    return () => {
      editor.off('selectionUpdate', notify)
      editor.off('transaction', notify)
    }
  }, [editor, computeActiveTask, onActiveTaskChange])

  return {
    computeActiveTask,
    activeTaskInfoRef
  }
}
