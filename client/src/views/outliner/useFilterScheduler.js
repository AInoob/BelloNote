import { useCallback, useEffect, useRef } from 'react'
import { now } from './performanceUtils.js'

/**
 * Custom hook to schedule and cancel filter application
 * @param {Function} applyStatusFilter - Function to apply status filter
 * @param {Object} filterScheduleRef - Ref to track scheduled filter
 * @param {Object} lastFilterRunAtRef - Ref to track last filter run time
 * @param {Object} filterRunCounterRef - Ref to track filter run counter
 * @returns {Object} Object with scheduleApplyStatusFilter and cancelScheduledFilter functions
 */
export function useFilterScheduler(
  applyStatusFilter,
  filterScheduleRef,
  lastFilterRunAtRef,
  filterRunCounterRef
) {
  const cancelScheduledFilter = useCallback(() => {
    const handle = filterScheduleRef.current
    if (!handle) return
    filterScheduleRef.current = null
    if (handle.type === 'raf') {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle.id)
      }
    } else if (handle.type === 'timeout') {
      clearTimeout(handle.id)
    }
  }, [filterScheduleRef])

  const scheduleApplyStatusFilter = useCallback((reason = 'unknown') => {
    const scheduledAt = now()
    const runFilter = () => {
      filterScheduleRef.current = null
      const runId = filterRunCounterRef.current = filterRunCounterRef.current + 1
      const start = now()
      try {
        applyStatusFilter()
      } finally {
        const end = now()
        lastFilterRunAtRef.current = end
      }
    }

    cancelScheduledFilter()

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => {
        runFilter()
      })
      filterScheduleRef.current = { type: 'raf', id: rafId, reason, scheduledAt }
    } else {
      const timeoutId = setTimeout(() => {
        runFilter()
      }, 16)
      filterScheduleRef.current = { type: 'timeout', id: timeoutId, reason, scheduledAt }
    }
  }, [applyStatusFilter, cancelScheduledFilter, filterScheduleRef, lastFilterRunAtRef, filterRunCounterRef])

  useEffect(() => () => { cancelScheduledFilter() }, [cancelScheduledFilter])

  return { scheduleApplyStatusFilter, cancelScheduledFilter }
}

