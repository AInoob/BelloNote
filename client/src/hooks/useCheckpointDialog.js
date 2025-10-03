import { useState, useCallback } from 'react'
import { createCheckpoint } from '../api/index.js'

/**
 * Custom hook to manage checkpoint dialog state and operations
 * @returns {Object} Checkpoint dialog state and controls
 */
export function useCheckpointDialog() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const openCheckpoint = useCallback(() => {
    setError(null)
    setOpen(true)
  }, [])

  const closeCheckpoint = useCallback(() => {
    setOpen(false)
    setBusy(false)
    setError(null)
  }, [])

  const createCheckpointAction = useCallback(async (payload) => {
    setBusy(true)
    setError(null)
    try {
      await createCheckpoint(payload)
    } catch (e) {
      setError(e?.message || String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    checkpointOpen: open,
    checkpointBusy: busy,
    checkpointError: error,
    openCheckpoint,
    closeCheckpoint,
    createCheckpoint: createCheckpointAction
  }
}

