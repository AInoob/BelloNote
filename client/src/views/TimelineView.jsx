// ============================================================================
// Timeline View Component
// Displays dated work logs, Soon, and Future sections
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { getDays, updateTask } from '../api.js'
import OutlinerView from './OutlinerView.jsx'
import { useOutlineSnapshot } from '../hooks/useOutlineSnapshot.js'
import { buildOutlineFromItems, collectSoonAndFuture } from './timeline/timelineUtils.js'

/**
 * Escapes a string for safe use in CSS selectors
 * @param {string} value - Value to escape
 * @returns {string} Escaped CSS selector string
 */
const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9\-_]/g, (match) => `\\${match}`)
}

// ============================================================================
// Timeline View Component
// ============================================================================

/**
 * TimelineView Component
 * Displays timeline with dated work logs, Soon, and Future sections
 * Supports focus navigation and status updates in read-only mode
 * @param {Object} props - Component props
 * @param {Object|null} [props.focusRequest=null] - Request to focus a specific task
 * @param {Function} [props.onFocusHandled] - Callback when focus is handled
 * @param {Function|null} [props.onNavigateOutline=null] - Callback to navigate to outline
 */
export default function TimelineView({ focusRequest = null, onFocusHandled = () => {}, onNavigateOutline = null }) {
  // State for timeline data and filters
  const [days, setDays] = useState([])
  const [showFuture, setShowFuture] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.future'); return v === '0' ? false : true } catch { return true } })
  const [showSoon, setShowSoon] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.soon'); return v === '0' ? false : true } catch { return true } })
  const [showFilters, setShowFilters] = useState(() => { try { const v = localStorage.getItem('worklog.timeline.filters'); return v === '0' ? false : true } catch { return true } })
  const [activeTaskId, setActiveTaskId] = useState(null)

  // Refs for DOM elements and focus management
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

  // ============================================================================
  // Data Loading
  // ============================================================================

  /**
   * Refreshes timeline data from server
   */
  const refreshData = useCallback(async () => {
    try {
      const data = await getDays()
      setDays(data.days || [])
      if (typeof window !== 'undefined') window.__WL_TIMELINE_DAYS = data.days || []
    } catch (err) {
      console.error('[timeline] failed to load days', err)
    }
  }, [])

  // ============================================================================
  // Focus Management
  // ============================================================================

  /**
   * Focuses a task by ID, scrolling it into view and highlighting it
   * @param {string|number} taskId - Task ID to focus
   * @returns {boolean} True if task was found and focused
   */
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
    }, 1200)
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

  // ============================================================================
  // Effects - Data Loading and Refresh
  // ============================================================================

  // Initial data load
  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Expose refresh function globally for external triggers
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

  // Listen for outline changes and trigger refresh
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) return
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        refreshData()
      }, 150)
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

  // Cleanup refresh timer
  useEffect(() => () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  // ============================================================================
  // Effects - Outline Snapshot
  // ============================================================================

  // Expose outline roots globally for debugging
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

  // ============================================================================
  // Effects - Auto-scroll to Today
  // ============================================================================

  // Scroll to today's section on initial load
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

  // ============================================================================
  // Effects - Focus Request Handling
  // ============================================================================

  const focusRequestTaskId = focusRequest?.taskId ? String(focusRequest.taskId) : null

  // Set active task ID from focus request
  useEffect(() => {
    if (!focusRequestTaskId) return
    setActiveTaskId(focusRequestTaskId)
    lastFocusedTaskIdRef.current = focusRequestTaskId
  }, [focusRequestTaskId])

  // Attempt to focus requested task
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

  // Retry pending focus when data updates
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

  // Cleanup flash timer
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  // ============================================================================
  // Effects - Click Handling
  // ============================================================================

  // Track active task on click
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

  // ============================================================================
  // Effects - Keyboard Shortcuts
  // ============================================================================

  // Cmd/Ctrl+S to navigate to outline
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

  // ============================================================================
  // Computed Values
  // ============================================================================

  // Extract Soon and Future tasks from outline
  const { soonRoots, futureRoots } = useMemo(() => collectSoonAndFuture(outlineRoots), [outlineRoots])

  // Check if there's any timeline data to display
  const hasTimelineData = (days?.length || 0) > 0 || soonRoots.length > 0 || futureRoots.length > 0

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles status toggle for tasks in read-only timeline
   * @param {string|number} id - Task ID
   * @param {string} nextStatus - New status value
   */
  const handleStatusToggle = async (id, nextStatus) => {
    try {
      await updateTask(id, { status: nextStatus })
      const data = await getDays(); setDays(data.days || [])
      const o = await getOutline(); setOutlineRoots(o.roots || [])
    } catch (e) {
      console.error('[timeline] failed to update status', e)
    }
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="timeline" ref={containerRef}>
      {/* Filter bar for timeline-specific toggles */}
      <div className="status-filter-bar" data-timeline-filter="1" style={{ marginBottom: 8, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="filters-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="meta">Filters:</span>
          <button className={`btn pill ${showFilters ? 'active' : ''}`} type="button" onClick={() => { const next = !showFilters; try { localStorage.setItem('worklog.timeline.filters', next ? '1' : '0') } catch {}; setShowFilters(next) }}>
            {showFilters ? 'Shown' : 'Hidden'}
          </button>
        </div>
        {showFilters && (
          <>
            <div className="future-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">Future:</span>
              <button className={`btn pill ${showFuture ? 'active' : ''}`} type="button" onClick={() => { const next = !showFuture; try { localStorage.setItem('worklog.timeline.future', next ? '1' : '0') } catch {}; setShowFuture(next) }}>
                {showFuture ? 'Shown' : 'Hidden'}
              </button>
            </div>
            <div className="soon-toggle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="meta">Soon:</span>
              <button className={`btn pill ${showSoon ? 'active' : ''}`} type="button" onClick={() => { const next = !showSoon; try { localStorage.setItem('worklog.timeline.soon', next ? '1' : '0') } catch {}; setShowSoon(next) }}>
                {showSoon ? 'Shown' : 'Hidden'}
              </button>
            </div>
          </>
        )}
      </div>

      {!hasTimelineData && (
        <div className="save-indicator" style={{ marginBottom: 16 }}>No work logs yet.</div>
      )}

      {/* Future bucket (should appear before Soon) */}
      {hasTimelineData && showFuture && futureRoots.length > 0 && (
        <section key="future">
          <h3>Future</h3>
          <div className="history-inline-preview">
            <OutlinerView
              readOnly={true}
              forceExpand={true}
              initialOutline={{ roots: futureRoots }}
              broadcastSnapshots={false}
              allowStatusToggleInReadOnly={true}
              reminderActionsEnabled={true}
              onStatusToggle={handleStatusToggle}
            />
          </div>
        </section>
      )}

      {/* Soon bucket */}
      {hasTimelineData && showSoon && soonRoots.length > 0 && (
        <section key="soon">
          <h3>Soon</h3>
          <div className="history-inline-preview">
            <OutlinerView
              readOnly={true}
              forceExpand={true}
              initialOutline={{ roots: soonRoots }}
              broadcastSnapshots={false}
              allowStatusToggleInReadOnly={true}
              reminderActionsEnabled={true}
              onStatusToggle={handleStatusToggle}
            />
          </div>
        </section>
      )}

      {/* Dated days */}
      {hasTimelineData && days.map(day => {
        const roots = buildOutlineFromItems(day.items || [], day.seedIds || [], day.date)
        const isToday = day.date && todayKeyRef.current && day.date === todayKeyRef.current
        return (
          <section key={day.date} ref={isToday ? todaySectionRef : undefined} data-timeline-date={day.date}>
            <h3>{day.date}</h3>
            <div className="history-inline-preview">
              <OutlinerView
                readOnly={true}
                forceExpand={true}
                initialOutline={{ roots }}
                broadcastSnapshots={false}
                allowStatusToggleInReadOnly={true}
                reminderActionsEnabled={true}
                onStatusToggle={handleStatusToggle}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}
