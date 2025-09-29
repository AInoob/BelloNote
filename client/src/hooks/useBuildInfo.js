import { useEffect, useState } from 'react'
import { getHealth } from '../api.js'

export function useBuildInfo() {
  const [serverBuildTime, setServerBuildTime] = useState(null)
  const [healthFetchedAt, setHealthFetchedAt] = useState(null)

  useEffect(() => {
    let cancelled = false

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
