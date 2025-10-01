// ============================================================================
// Build Info Hook
// React hook for fetching server build information via health endpoint
// ============================================================================

import { useEffect, useState } from 'react'
import { getHealth } from '../api.js'

/**
 * useBuildInfo Hook
 * Fetches server build time and health status on mount
 * @returns {Object} Object with serverBuildTime and healthFetchedAt
 */
export function useBuildInfo() {
  const [serverBuildTime, setServerBuildTime] = useState(null)
  const [healthFetchedAt, setHealthFetchedAt] = useState(null)

  useEffect(() => {
    let cancelled = false

    /** Loads health data from server */
    const load = async () => {
      try {
        const data = await getHealth()
        if (cancelled) return
        setServerBuildTime(data?.buildTime || null)
        setHealthFetchedAt(new Date())
      } catch (error) {
        if (cancelled) return
        setServerBuildTime(null)
        setHealthFetchedAt(new Date())
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  return { serverBuildTime, healthFetchedAt }
}
