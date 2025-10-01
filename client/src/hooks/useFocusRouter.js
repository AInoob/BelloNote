import { useCallback, useState } from 'react'
import { TAB_IDS } from '../constants/config.js'

/**
 * Normalize focus request payload
 * @param {Object} payload - The focus request payload
 * @returns {Object|null} Normalized payload with taskId and token
 */
function normalizePayload(payload) {
  if (!payload || !payload.taskId) return null
  return {
    ...payload,
    taskId: String(payload.taskId),
    token: Date.now()
  }
}

/**
 * Hook to manage focus routing between Timeline and Outline views
 * Handles navigation requests and focus state management
 *
 * @param {Function} setTab - Function to set the active tab
 * @returns {Object} Focus router state and handlers
 */
export function useFocusRouter(setTab) {
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(null)
  const [outlineFocusRequest, setOutlineFocusRequest] = useState(null)

  const requestTimelineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab(TAB_IDS.TIMELINE)
    setTimelineFocusRequest(normalized)
  }, [setTab])

  const handleTimelineFocusHandled = useCallback((success) => {
    if (success) setTimelineFocusRequest(null)
  }, [])

  const requestOutlineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab(TAB_IDS.OUTLINE)
    setOutlineFocusRequest(normalized)
  }, [setTab])

  const handleOutlineFocusHandled = useCallback((success) => {
    if (success) setOutlineFocusRequest(null)
  }, [])

  return {
    timelineFocusRequest,
    outlineFocusRequest,
    requestTimelineFocus,
    requestOutlineFocus,
    handleTimelineFocusHandled,
    handleOutlineFocusHandled
  }
}
