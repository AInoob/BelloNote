import { useEffect, useState } from 'react'
import { getOutline } from '../api.js'
import { buildOutlineIndex } from '../utils/outline.js'

const SNAPSHOT_EVENT = 'worklog:outline-snapshot'

/**
 * Hook to manage outline snapshot state
 * Loads initial outline and listens for snapshot updates
 * Maintains both the outline tree and a flat index map
 *
 * @returns {Object} Outline roots array and indexed map
 */
export function useOutlineSnapshot() {
  const [outlineRoots, setOutlineRoots] = useState(() => [])
  const [outlineMap, setOutlineMap] = useState(() => new Map())

  useEffect(() => {
    let cancelled = false

    const applyRoots = (roots = []) => {
      if (cancelled) return
      const normalized = Array.isArray(roots) ? roots : []
      setOutlineRoots(normalized)
      setOutlineMap(buildOutlineIndex(normalized))
    }

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

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true
      }
    }

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
