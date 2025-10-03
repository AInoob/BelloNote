import React, { useCallback, useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { getDays, updateTask } from '../api.js'
import OutlinerView from './OutlinerView.jsx'
import { useOutlineSnapshot } from '../hooks/useOutlineSnapshot.js'
import { cssEscape } from '../utils/cssEscape.js'
import { FOCUS_FLASH_DURATION, REFRESH_DEBOUNCE_DELAY } from './timeline/constants.js'
import { buildOutlineFromItems } from './timeline/timelineUtils.js'
import LazyMount from '../components/LazyMount.jsx'


export default function TimelineView({ focusRequest = null, onFocusHandled = () => {}, onNavigateOutline = null }) {
  const [days, setDays] = useState([])
  const [activeTaskId, setActiveTaskId] = useState(null)
  const containerRef = useRef(null)
  const flashTimerRef = useRef(null)
  const lastFocusTokenRef = useRef(null)
  const pendingFocusRef = useRef(null)
  const lastFocusedTaskIdRef = useRef(null)
  const activeElementRef = useRef(null)
  const todaySectionRef = useRef(null)
  const todayScrollDoneRef = useRef(false)
  const todayKeyRef = useRef(dayjs().format('YYYY-MM-DD'))
  const refreshTimerRef = useRef(null)

  const { outlineRoots } = useOutlineSnapshot()

  const refreshData = useCallback(async () => {
    try {
      const data = await getDays()
      setDays(data.days || [])
      if (typeof window !== 'undefined') window.__WL_TIMELINE_DAYS = data.days || []
    } catch (err) {
      console.error('[timeline] failed to load days', err)
    }
  }, [])

  const focusTaskById = useCallback((taskId) => {
    if (!taskId) return false
    const root = containerRef.current
    if (!root) return false
    let target = null
    try {
      target = root.querySelector(`li.li-node[data-id="${cssEscape(taskId)}"]`)
    } catch {
      target = null
    }
    if (!target) return false
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('timeline-shortcut-focus')
    flashTimerRef.current = setTimeout(() => {
      target.classList.remove('timeline-shortcut-focus')
      flashTimerRef.current = null
    }, FOCUS_FLASH_DURATION)
    if (activeElementRef.current && activeElementRef.current !== target) {
      activeElementRef.current.removeAttribute('data-timeline-active')
    }
    target.setAttribute('data-timeline-active', '1')
    activeElementRef.current = target

    const idStr = String(taskId)
    setActiveTaskId(idStr)
    lastFocusedTaskIdRef.current = idStr
    return true
  }, [])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__WL_TIMELINE_REFRESH = refreshData
    }
    return () => {
      if (typeof window !== 'undefined' && window.__WL_TIMELINE_REFRESH === refreshData) {
        window.__WL_TIMELINE_REFRESH = undefined
      }
    }
  }, [refreshData])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) return
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        refreshData()
      }, REFRESH_DEBOUNCE_DELAY)
    }
    const handleOutlineSnapshot = () => { scheduleRefresh() }
    const handleReminderAction = () => { scheduleRefresh() }
    window.addEventListener('worklog:outline-snapshot', handleOutlineSnapshot)
    window.addEventListener('worklog:reminder-action', handleReminderAction)
    return () => {
      window.removeEventListener('worklog:outline-snapshot', handleOutlineSnapshot)
      window.removeEventListener('worklog:reminder-action', handleReminderAction)
    }
  }, [refreshData])

  useEffect(() => () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.__WL_TIMELINE_OUTLINE = outlineRoots || []
    return () => {
      if (typeof window === 'undefined') return
      if (window.__WL_TIMELINE_OUTLINE === outlineRoots) {
        window.__WL_TIMELINE_OUTLINE = undefined
      }
    }
  }, [outlineRoots])

  useEffect(() => {
    if (todayScrollDoneRef.current) return
    const target = todaySectionRef.current
    if (!target) return
    todayScrollDoneRef.current = true
    requestAnimationFrame(() => {
      const el = todaySectionRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [days])

  const focusRequestTaskId = focusRequest?.taskId ? String(focusRequest.taskId) : null

  useEffect(() => {
    if (!focusRequestTaskId) return
    setActiveTaskId(focusRequestTaskId)
    lastFocusedTaskIdRef.current = focusRequestTaskId
  }, [focusRequestTaskId])

  useEffect(() => {
    if (!focusRequestTaskId) return undefined
    const token = focusRequest?.token ?? `${focusRequestTaskId}:${focusRequest?.reminderId ?? ''}:${focusRequest?.remindAt ?? ''}`
    if (lastFocusTokenRef.current === token && !pendingFocusRef.current) return undefined
    const success = focusTaskById(focusRequestTaskId)
    if (success) {
      pendingFocusRef.current = null
      lastFocusTokenRef.current = token
      onFocusHandled?.(true)
    } else {
      pendingFocusRef.current = token
    }
    return undefined
  }, [focusRequest, focusRequestTaskId, focusTaskById, onFocusHandled])

  useEffect(() => {
    if (!pendingFocusRef.current || !focusRequestTaskId) return undefined
    const success = focusTaskById(focusRequestTaskId)
    if (success) {
      lastFocusTokenRef.current = pendingFocusRef.current
      pendingFocusRef.current = null
      onFocusHandled?.(true)
    }
    return undefined
  }, [days, outlineRoots, focusTaskById, focusRequestTaskId, onFocusHandled])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return undefined
    const handleClick = (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest('li.li-node') : null
      if (!target) return
      const dataId = target.getAttribute('data-id')
      if (dataId) setActiveTaskId(dataId)
    }
    root.addEventListener('click', handleClick)
    return () => root.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    const handler = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.shiftKey || event.altKey) return
      if (event.key !== 's' && event.key !== 'S') return
      if (typeof window !== 'undefined' && window.__APP_ACTIVE_TAB__ !== 'timeline') return
      const targetId = activeTaskId || lastFocusedTaskIdRef.current || focusRequestTaskId
      if (!targetId) return
      event.preventDefault()
      event.stopPropagation()
      onNavigateOutline?.({ taskId: targetId })
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeTaskId, onNavigateOutline, focusRequestTaskId])

  const hasTimelineData = (days?.length || 0) > 0

  const handleStatusToggle = async (id, nextStatus) => {
    try {
      await updateTask(id, { status: nextStatus })
      const data = await getDays(); setDays(data.days || [])
      const o = await getOutline(); setOutlineRoots(o.roots || [])
    } catch (e) {
      console.error('[timeline] failed to update status', e)
    }
  }
  return (
    <div className="timeline" ref={containerRef}>
      {/* Filter bar for timeline-specific toggles */}

      {!hasTimelineData && (
        <div className="save-indicator" style={{ marginBottom: 16 }}>No work logs yet.</div>
      )}

      {/* Dated days */}
      {hasTimelineData && days.map(day => {
        const roots = buildOutlineFromItems(day.items || [], day.seedIds || [], day.date)
        const isToday = day.date && todayKeyRef.current && day.date === todayKeyRef.current
        return (
          <section key={day.date} ref={isToday ? todaySectionRef : undefined} data-timeline-date={day.date}>
            <h3>{day.date}</h3>
            <div className="history-inline-preview" style={{ minHeight: 48 }}>
              <LazyMount rootMargin="600px" once={true}>
                <OutlinerView
                  readOnly
                  forceExpand
                  initialOutline={{ roots }}
                  broadcastSnapshots={false}
                  allowStatusToggleInReadOnly
                  reminderActionsEnabled
                  onStatusToggle={handleStatusToggle}
                />
              </LazyMount>
            </div>
          </section>
        )
      })}
    </div>
  )
}
