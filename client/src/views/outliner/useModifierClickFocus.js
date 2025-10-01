import { useEffect } from 'react'

/**
 * Custom hook to handle modifier+click to focus on tasks
 * @param {Object} requestFocusRef - Ref to request focus function
 */
export function useModifierClickFocus(requestFocusRef) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handler = (event) => {
      if (!(event instanceof MouseEvent)) return
      if (event.type === 'mousedown' && event.button !== 0) return
      const usingModifier = event.metaKey || (event.ctrlKey && !event.metaKey)
      if (!usingModifier) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('a')) return
      const li = target instanceof HTMLElement ? target.closest('li.li-node') : null
      if (!li) return
      const id = li.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      requestFocusRef.current?.(String(id))
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('click', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('click', handler, true)
    }
  }, [requestFocusRef])
}

