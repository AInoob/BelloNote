import { useEffect, useRef } from 'react'
import { saveScrollState } from './scrollState.js'

function createDebounce(fn, wait) {
  let timeout = null
  const debounced = (...args) => {
    if (timeout) clearTimeout(timeout)
    timeout = window.setTimeout(() => {
      timeout = null
      fn(...args)
    }, wait)
  }
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }
  debounced.flush = (...args) => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
    fn(...args)
  }
  return debounced
}

/**
 * Custom hook to save scroll state and selection position
 * @param {Object} editor - TipTap editor instance
 * @param {boolean} isReadOnly - Whether the editor is read-only
 * @param {Object} restoredScrollRef - Ref to track if scroll has been restored
 * @param {Object} scrollSaveFrameRef - Ref to track animation frame for saving
 */
export function useScrollStateSaver(editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef) {
  const debouncedSaveRef = useRef(null)

  useEffect(() => {
    if (!editor || isReadOnly) return
    if (typeof window === 'undefined') return

    if (!debouncedSaveRef.current) {
      debouncedSaveRef.current = createDebounce(saveScrollState, 250)
    }
    const debouncedSave = debouncedSaveRef.current

    const performSave = () => {
      if (typeof window === 'undefined') return
      if (!restoredScrollRef.current) return
      const payload = {
        scrollY: window.scrollY,
        selectionFrom: editor?.state?.selection?.from ?? null,
        timestamp: Date.now()
      }
      debouncedSave(payload)
    }
    const scheduleSave = () => {
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      scrollSaveFrameRef.current = requestAnimationFrame(performSave)
    }
    const handleBeforeUnload = () => {
      if (!restoredScrollRef.current) return
      const payload = {
        scrollY: window.scrollY,
        selectionFrom: editor?.state?.selection?.from ?? null,
        timestamp: Date.now()
      }
      debouncedSave.flush(payload)
    }
    window.addEventListener('scroll', scheduleSave, { passive: true })
    window.addEventListener('beforeunload', handleBeforeUnload)
    editor.on('selectionUpdate', scheduleSave)
    return () => {
      window.removeEventListener('scroll', scheduleSave)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      editor.off('selectionUpdate', scheduleSave)
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      debouncedSave.cancel()
    }
  }, [editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef])
}
