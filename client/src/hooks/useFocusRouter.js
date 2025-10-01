import { useCallback, useState } from 'react'

function normalizePayload(payload) {
  if (!payload || !payload.taskId) return null
  return {
    ...payload,
    taskId: String(payload.taskId),
    token: Date.now()
  }
}

function useFocusChannel(setTab, targetTab) {
  const [request, setRequest] = useState(null)

  const askForFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab(targetTab)
    setRequest(normalized)
  }, [setTab, targetTab])

  const acknowledge = useCallback((handled) => {
    if (!handled) return
    setRequest(null)
  }, [])

  return { request, askForFocus, acknowledge }
}

export function useFocusRouter(setTab) {
  const timeline = useFocusChannel(setTab, 'timeline')
  const outline = useFocusChannel(setTab, 'outline')

  return {
    timelineFocusRequest: timeline.request,
    outlineFocusRequest: outline.request,
    requestTimelineFocus: timeline.askForFocus,
    requestOutlineFocus: outline.askForFocus,
    handleTimelineFocusHandled: timeline.acknowledge,
    handleOutlineFocusHandled: outline.acknowledge
  }
}
