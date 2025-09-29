import { useCallback, useState } from 'react'

function normalizePayload(payload) {
  if (!payload || !payload.taskId) return null
  return {
    ...payload,
    taskId: String(payload.taskId),
    token: Date.now()
  }
}

export function useFocusRouter(setTab) {
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(null)
  const [outlineFocusRequest, setOutlineFocusRequest] = useState(null)

  const requestTimelineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab('timeline')
    setTimelineFocusRequest(normalized)
  }, [setTab])

  const handleTimelineFocusHandled = useCallback((success) => {
    if (success) setTimelineFocusRequest(null)
  }, [setTimelineFocusRequest])

  const requestOutlineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab('outline')
    setOutlineFocusRequest(normalized)
  }, [setTab])

  const handleOutlineFocusHandled = useCallback((success) => {
    if (success) setOutlineFocusRequest(null)
  }, [setOutlineFocusRequest])

  return {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  }
}
