import { useEffect } from 'react'
import { cssEscape } from '../../utils/cssEscape.js'

/**
 * Custom hook to scroll to focused root task
 * @param {string|null} focusRootId - ID of the focused root task
 * @param {Object} editor - TipTap editor instance
 * @param {Object} pendingFocusScrollRef - Ref to track pending focus scroll
 */
export function useFocusRootScroll(focusRootId, editor, pendingFocusScrollRef) {
  useEffect(() => {
    if (!focusRootId) return
    if (!editor || !editor.view || !editor.view.dom) return
    const targetId = focusRootId
    const runScroll = () => {
      try {
        const rootEl = editor.view.dom
        let targetEl = null
        try {
          targetEl = rootEl.querySelector(`li.li-node[data-id="${cssEscape(String(targetId))}"]`)
        } catch {
          targetEl = null
        }
        if (!targetEl) return
        const rect = targetEl.getBoundingClientRect()
        const viewportHeight = window.innerHeight || 0
        const desired = Math.max(0, (rect.top + window.scrollY) - Math.max(0, (viewportHeight / 2) - (rect.height / 2)))
        window.scrollTo({ top: desired, behavior: 'smooth' })
      } finally {
        pendingFocusScrollRef.current = null
      }
    }
    const requestedId = pendingFocusScrollRef.current
    if (requestedId && requestedId !== focusRootId) {
      pendingFocusScrollRef.current = focusRootId
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(runScroll)
    })
  }, [focusRootId, editor, pendingFocusScrollRef])
}

