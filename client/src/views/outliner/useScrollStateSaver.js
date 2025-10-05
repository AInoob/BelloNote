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

  const captureTopTaskState = () => {
    if (!editor || !editor.view || !editor.view.dom) return { topTaskId: null, topTaskOffset: null }
    if (typeof window === 'undefined') return { topTaskId: null, topTaskOffset: null }
    const rootEl = editor.view.dom
    const nodes = Array.from(rootEl.querySelectorAll('li.li-node[data-id]'))
    if (!nodes.length) return { topTaskId: null, topTaskOffset: null }

    const pickTopVisible = () => {
      for (const node of nodes) {
        const rect = node.getBoundingClientRect()
        if (!rect || !Number.isFinite(rect.top) || rect.height <= 0) continue
        if (rect.bottom <= 0) continue
        const id = node.getAttribute('data-id')
        if (!id) continue
        return { topTaskId: id, topTaskOffset: Number((rect.top).toFixed(3)) }
      }
      return null
    }

    const candidate = pickTopVisible()
    if (candidate) return candidate

    const fallbackNode = nodes[nodes.length - 1]
    const fallbackRect = fallbackNode?.getBoundingClientRect()
    const fallbackId = fallbackNode?.getAttribute('data-id') || null
    const fallbackOffset = fallbackRect && Number.isFinite(fallbackRect.top)
      ? Number(fallbackRect.top.toFixed(3))
      : null
    return { topTaskId: fallbackId, topTaskOffset: fallbackOffset }
  }

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
      const { topTaskId, topTaskOffset } = captureTopTaskState()
      const payload = {
        topTaskId,
        topTaskOffset,
        scrollY: window.scrollY,
        selectionFrom: editor?.state?.selection?.from ?? null,
        timestamp: Date.now()
      }
      debouncedSave(payload)
    }
    const scheduleSave = (reason) => {
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      scrollSaveFrameRef.current = requestAnimationFrame(performSave)
    }
    const handleBeforeUnload = () => {
      if (!restoredScrollRef.current) return
      const { topTaskId, topTaskOffset } = captureTopTaskState()
      const payload = {
        topTaskId,
        topTaskOffset,
        scrollY: window.scrollY,
        selectionFrom: editor?.state?.selection?.from ?? null,
        timestamp: Date.now()
      }
      debouncedSave.flush(payload)
    }
    const handleScroll = () => scheduleSave('scroll')
    const handleSelectionUpdate = () => scheduleSave('selection')
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('beforeunload', handleBeforeUnload)
    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      editor.off('selectionUpdate', handleSelectionUpdate)
      if (scrollSaveFrameRef.current) cancelAnimationFrame(scrollSaveFrameRef.current)
      debouncedSave.cancel()
    }
  }, [editor, isReadOnly, restoredScrollRef, scrollSaveFrameRef])
}
