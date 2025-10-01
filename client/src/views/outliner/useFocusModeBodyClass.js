import { useEffect } from 'react'

/**
 * Custom hook to add/remove focus mode class to body element
 * @param {string|null} focusRootId - ID of the focused root task
 */
export function useFocusModeBodyClass(focusRootId) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    if (!body) return undefined
    const className = 'focus-mode'
    if (focusRootId) body.classList.add(className)
    else body.classList.remove(className)
    return () => {
      if (focusRootId) body.classList.remove(className)
    }
  }, [focusRootId])
}

