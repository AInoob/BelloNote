import { useEffect } from 'react'
import { saveScrollState } from './scrollState.js'

/**
 * Custom hook to save scroll state and selection position
 * @param {Object} editor - TipTap editor instance
 * @param {boolean} isReadOnly - Whether the editor is read-only
 * @param {Object} restoredScrollRef - Ref to track if scroll has been restored
 * @param {Object} scrollSaveFrameRef - Ref to track animation frame for saving
 */
export function useScrollStateSaver(editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef) {
  useEffect(() => {
    if (!editor || isReadOnly) return
    const performSave = () => {
      if (typeof window === 'undefined') return
      if (!restoredScrollRef.current) return
      const payload = {
        scrollY: window.scrollY,
        selectionFrom: editor?.state?.selection?.from ?? null,
        timestamp: Date.now()
      }
      saveScrollState(payload)
    }
    const scheduleSave = () => {
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      scrollSaveFrameRef.current = requestAnimationFrame(performSave)
    }
    window.addEventListener('scroll', scheduleSave, { passive: true })
    window.addEventListener('beforeunload', performSave)
    editor.on('selectionUpdate', scheduleSave)
    return () => {
      window.removeEventListener('scroll', scheduleSave)
      window.removeEventListener('beforeunload', performSave)
      editor.off('selectionUpdate', scheduleSave)
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
    }
  }, [editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef])
}

