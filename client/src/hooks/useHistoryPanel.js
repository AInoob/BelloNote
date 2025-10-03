import { useState, useCallback } from 'react'

/**
 * Custom hook to manage history panel open/close state
 * @param {boolean} [initialOpen=false] - Initial open state
 * @returns {Object} History panel state and controls
 */
export function useHistoryPanel(initialOpen = false) {
  const [isOpen, setOpen] = useState(initialOpen)
  
  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen(v => !v), [])
  
  return {
    isHistoryOpen: isOpen,
    openHistory: open,
    closeHistory: close,
    toggleHistory: toggle
  }
}

