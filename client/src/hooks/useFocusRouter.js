// ============================================================================
// Focus Router Hook
// React hook for managing focus requests across Timeline and Outline tabs
// ============================================================================

import { useCallback, useState } from 'react'

/**
 * Normalizes a focus request payload
 * Ensures taskId is a string and adds a timestamp token
 * @param {Object} payload - Focus request payload
 * @returns {Object|null} Normalized payload or null if invalid
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
 * useFocusRouter Hook
 * Manages focus requests for Timeline and Outline tabs
 * Switches tabs and requests focus on specific tasks
 * @param {Function} setTab - Function to switch active tab
 * @returns {Object} Focus request state and handlers
 */
export function useFocusRouter(setTab) {
  // ============================================================================
  // State
  // ============================================================================

  const [timelineFocusRequest, setTimelineFocusRequest] = useState(null)
  const [outlineFocusRequest, setOutlineFocusRequest] = useState(null)

  // ============================================================================
  // Timeline Focus Handlers
  // ============================================================================

  /**
   * Requests focus on a task in the Timeline tab
   * @param {Object} payload - Focus request payload with taskId
   */
  const requestTimelineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab('timeline')
    setTimelineFocusRequest(normalized)
  }, [setTab])

  /**
   * Called when Timeline handles a focus request
   * @param {boolean} success - Whether focus was successful
   */
  const handleTimelineFocusHandled = useCallback((success) => {
    if (success) setTimelineFocusRequest(null)
  }, [setTimelineFocusRequest])

  // ============================================================================
  // Outline Focus Handlers
  // ============================================================================

  /**
   * Requests focus on a task in the Outline tab
   * @param {Object} payload - Focus request payload with taskId
   */
  const requestOutlineFocus = useCallback((payload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) return
    setTab('outline')
    setOutlineFocusRequest(normalized)
  }, [setTab])

  /**
   * Called when Outline handles a focus request
   * @param {boolean} success - Whether focus was successful
   */
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
