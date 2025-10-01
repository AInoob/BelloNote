import { useEffect, useRef } from 'react'

/**
 * Custom hook to manage focus shortcut state (Cmd/Ctrl key detection)
 * Adds 'focus-shortcut-available' class to body when Cmd/Ctrl is pressed
 * 
 * @returns {Object} Reference to the focus shortcut active state
 */
export function useFocusShortcut() {
  const focusShortcutActiveRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const applyShortcutState = (active) => {
      if (focusShortcutActiveRef.current === active) return
      focusShortcutActiveRef.current = active
      if (typeof document === 'undefined') return
      const body = document.body
      if (!body) return
      body.classList.toggle('focus-shortcut-available', active)
    }

    const computeActive = (event) => {
      if (!event) return false
      return !!(event.metaKey || (event.ctrlKey && !event.metaKey))
    }

    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleKeyUp = (event) => {
      if (focusShortcutActiveRef.current || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleBlur = () => applyShortcutState(false)

    const handleVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') applyShortcutState(false)
    }

    const doc = typeof document !== 'undefined' ? document : null

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    if (doc) {
      doc.addEventListener('keydown', handleKeyDown, true)
      doc.addEventListener('keyup', handleKeyUp, true)
      doc.addEventListener('visibilitychange', handleVisibility)
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      if (doc) {
        doc.removeEventListener('keydown', handleKeyDown, true)
        doc.removeEventListener('keyup', handleKeyUp, true)
        doc.removeEventListener('visibilitychange', handleVisibility)
      }
      applyShortcutState(false)
    }
  }, [])

  return focusShortcutActiveRef
}

