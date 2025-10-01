import { useEffect } from 'react'

/**
 * Custom hook to notify when active task changes
 * @param {Object} editor - TipTap editor instance
 * @param {Function} computeActiveTask - Function to compute active task
 * @param {Function} onActiveTaskChange - Callback when active task changes
 * @param {Object} activeTaskInfoRef - Ref to track active task info
 */
export function useActiveTaskNotifier(editor, computeActiveTask, onActiveTaskChange, activeTaskInfoRef) {
  useEffect(() => {
    if (!editor) return undefined
    const notify = () => {
      const info = computeActiveTask()
      const prev = activeTaskInfoRef.current
      const prevKey = prev ? `${prev.id}|${prev.hasReminder}|${prev.hasDate}|${prev.reminderDate}|${(prev.dates || []).join(',')}` : ''
      const nextKey = info ? `${info.id}|${info.hasReminder}|${info.hasDate}|${info.reminderDate}|${(info.dates || []).join(',')}` : ''
      if (prevKey === nextKey) return
      activeTaskInfoRef.current = info
      onActiveTaskChange?.(info)
    }
    notify()
    editor.on('selectionUpdate', notify)
    editor.on('transaction', notify)
    return () => {
      editor.off('selectionUpdate', notify)
      editor.off('transaction', notify)
    }
  }, [editor, computeActiveTask, onActiveTaskChange, activeTaskInfoRef])
}

