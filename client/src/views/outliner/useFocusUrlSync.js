import { useEffect } from 'react'

/**
 * Custom hook to sync focus state with URL
 * @param {string|null} focusRootId - Current focus root ID
 * @param {Function} setFocusRootId - Function to set focus root ID
 * @param {Function} readFocusFromLocation - Function to read focus from URL
 * @param {Object} suppressUrlSyncRef - Ref to suppress URL sync
 * @param {Object} initialFocusSyncRef - Ref to track initial sync
 */
export function useFocusUrlSync(
  focusRootId,
  setFocusRootId,
  readFocusFromLocation,
  suppressUrlSyncRef,
  initialFocusSyncRef
) {
  // Handle browser back/forward navigation
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const next = readFocusFromLocation()
      suppressUrlSyncRef.current = true
      setFocusRootId(next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [readFocusFromLocation, setFocusRootId, suppressUrlSyncRef])

  // Update URL when focus changes
  useEffect(() => {
    if (initialFocusSyncRef.current) {
      initialFocusSyncRef.current = false
      return
    }
    if (suppressUrlSyncRef.current) {
      suppressUrlSyncRef.current = false
      return
    }
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      if (focusRootId) url.searchParams.set('focus', focusRootId)
      else url.searchParams.delete('focus')
      window.history.pushState({ focus: focusRootId }, '', url)
    } catch {}
  }, [focusRootId, suppressUrlSyncRef, initialFocusSyncRef])
}

