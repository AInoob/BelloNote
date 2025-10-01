import { useEffect } from 'react'

/**
 * Custom hook to listen for reminder action events
 * @param {Object} editor - TipTap editor instance
 * @param {Function} applyReminderAction - Function to apply reminder action
 */
export function useReminderActionListener(editor, applyReminderAction) {
  useEffect(() => {
    if (!editor) return undefined
    const handler = (event) => {
      const detail = event?.detail
      if (!detail) return
      applyReminderAction(detail)
    }
    window.addEventListener('worklog:reminder-action', handler)
    return () => window.removeEventListener('worklog:reminder-action', handler)
  }, [editor, applyReminderAction])
}

