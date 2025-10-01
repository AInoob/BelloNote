// ============================================================================
// Outline Snapshot Hook
// React hook for syncing with current outline state across the app
// ============================================================================

import { useEffect, useState } from 'react'
import { getOutline } from '../api.js'
import { buildOutlineIndex } from '../utils/outline.js'

/** Custom event name for outline snapshot broadcasts */
const SNAPSHOT_EVENT = 'worklog:outline-snapshot'

/**
 * useOutlineSnapshot Hook
 * Provides access to the current outline structure and index
 * Listens for outline updates via custom events
 * @returns {Object} Object with outlineRoots (array) and outlineMap (Map)
 */
export function useOutlineSnapshot() {
  // ============================================================================
  // State
  // ============================================================================

  const [outlineRoots, setOutlineRoots] = useState(() => [])
  const [outlineMap, setOutlineMap] = useState(() => new Map())

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    let cancelled = false

    /**
     * Applies new outline roots and rebuilds the index
     * @param {Array} roots - Outline root nodes
     */
    const applyRoots = (roots = []) => {
      if (cancelled) return
      const normalized = Array.isArray(roots) ? roots : []
      setOutlineRoots(normalized)
      setOutlineMap(buildOutlineIndex(normalized))
    }

    /** Loads initial outline from server */
    const loadInitial = async () => {
      try {
        const data = await getOutline()
        applyRoots(data?.roots || [])
      } catch (error) {
        console.error('[useOutlineSnapshot] failed to load outline', error)
        applyRoots([])
      }
    }

    loadInitial()

    // Server-side: skip event listeners
    if (typeof window === 'undefined') {
      return () => {
        cancelled = true
      }
    }

    // Listen for outline snapshot updates
    const handler = (event) => {
      const roots = event?.detail?.outline
      applyRoots(roots)
    }

    window.addEventListener(SNAPSHOT_EVENT, handler)

    return () => {
      cancelled = true
      window.removeEventListener(SNAPSHOT_EVENT, handler)
    }
  }, [])

  return { outlineRoots, outlineMap }
}
