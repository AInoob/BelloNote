import { useCallback, useEffect, useState } from 'react'
import { getOutline } from '../api.js'
import { buildOutlineIndex } from '../utils/outline.js'

const SNAPSHOT_EVENT = 'worklog:outline-snapshot'
const INITIAL_STATE = { outlineRoots: [], outlineMap: new Map() }

function normalizeRoots(roots) {
  return Array.isArray(roots) ? roots : []
}

export function useOutlineSnapshot() {
  const [snapshot, setSnapshot] = useState(INITIAL_STATE)

  const applyRoots = useCallback((roots) => {
    const normalized = normalizeRoots(roots)
    setSnapshot({
      outlineRoots: normalized,
      outlineMap: buildOutlineIndex(normalized)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInitial = async () => {
      try {
        const data = await getOutline()
        if (!cancelled) applyRoots(data?.roots)
      } catch (error) {
        console.error('[useOutlineSnapshot] failed to load outline', error)
        if (!cancelled) applyRoots([])
      }
    }

    loadInitial()

    if (typeof window === 'undefined') {
      return () => {
        cancelled = true
      }
    }

    const handler = (event) => {
      if (cancelled) return
      applyRoots(event?.detail?.outline)
    }

    window.addEventListener(SNAPSHOT_EVENT, handler)

    return () => {
      cancelled = true
      window.removeEventListener(SNAPSHOT_EVENT, handler)
    }
  }, [applyRoots])

  return snapshot
}
