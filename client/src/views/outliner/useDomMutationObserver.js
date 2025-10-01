import { useEffect } from 'react'
import { now } from './performanceUtils.js'

/**
 * Custom hook to observe DOM mutations and schedule filter application
 * @param {Object} editor - TipTap editor instance
 * @param {Function} scheduleApplyStatusFilter - Function to schedule filter application
 * @param {Object} filterScheduleRef - Ref to filter schedule
 * @param {Object} lastFilterRunAtRef - Ref to last filter run timestamp
 */
export function useDomMutationObserver(editor, scheduleApplyStatusFilter, filterScheduleRef, lastFilterRunAtRef) {
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    let t = null
    const observer = new MutationObserver(() => {
      if (t) {
        clearTimeout(t.id)
      }
      const timeoutId = setTimeout(() => {
        t = null
        const timestamp = now()
        const lastRunAt = lastFilterRunAtRef.current || 0
        const sinceLast = timestamp - lastRunAt
        if (filterScheduleRef.current) {
          return
        }
        if (sinceLast >= 0 && sinceLast < 30) {
          return
        }
        scheduleApplyStatusFilter('mutation-observer')
        t = null
      }, 50)
      t = { id: timeoutId }
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (t) clearTimeout(t.id)
    }
  }, [editor, scheduleApplyStatusFilter, filterScheduleRef, lastFilterRunAtRef])
}

