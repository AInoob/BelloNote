import { useEffect, useState } from 'react'
import { getHealth } from '../api.js'

const INITIAL_STATE = { serverBuildTime: null, healthFetchedAt: null }

export function useBuildInfo() {
  const [info, setInfo] = useState(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    const applyResult = (buildTime) => {
      if (cancelled) return
      setInfo({
        serverBuildTime: buildTime ?? null,
        healthFetchedAt: new Date()
      })
    }

    const fetchHealth = async () => {
      try {
        const data = await getHealth()
        applyResult(data?.buildTime)
      } catch {
        applyResult(null)
      }
    }

    fetchHealth()

    return () => {
      cancelled = true
    }
  }, [])

  return info
}
