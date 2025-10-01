// ============================================================================
// Focus Mode Hook
// Manages focus mode state, navigation, URL sync, and title extraction
// ============================================================================

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { extractTitle } from './outlineUtils.js'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './focusCollapsedStorage.js'
import { focusTaskById as focusTaskByIdHelper, scrollToFocusedTask } from './focusTaskHelpers.js'

export function useFocusMode({
  editor,
  forceExpand,
  scheduleApplyStatusFilter,
  applyCollapsedStateForRoot,
  applyStatusFilter,
  computeActiveTask,
  activeTaskInfoRef,
  focusRequest,
  onFocusHandled
}) {
  const [focusRootId, setFocusRootId] = useState(() => {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get('focus')
    } catch {
      return null
    }
  })

  const [focusTitle, setFocusTitle] = useState('')
  const focusRootRef = useRef(focusRootId)
  const suppressUrlSyncRef = useRef(false)
  const initialFocusSyncRef = useRef(true)
  const pendingFocusScrollRef = useRef(null)
  const focusShortcutActiveRef = useRef(false)
  const lastFocusTokenRef = useRef(null)

  useEffect(() => { focusRootRef.current = focusRootId }, [focusRootId])

  // Focus shortcut visualization (Cmd/Ctrl hover)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const applyShortcutState = (active) => {
      if (focusShortcutActiveRef.current === active) return
      focusShortcutActiveRef.current = active
      if (typeof document === 'undefined') return
      const body = document.body
      if (!body) return
      body.classList.toggle('focus-shortcut-available', active)
    }

    const computeActive = (event) => {
      if (!event) return false
      return !!(event.metaKey || (event.ctrlKey && !event.metaKey))
    }

    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleKeyUp = (event) => {
      if (focusShortcutActiveRef.current || event.key === 'Meta' || event.key === 'Control') {
        applyShortcutState(computeActive(event))
      }
    }

    const handleBlur = () => applyShortcutState(false)

    const handleVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') applyShortcutState(false)
    }

    const doc = typeof document !== 'undefined' ? document : null

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    if (doc) {
      doc.addEventListener('keydown', handleKeyDown, true)
      doc.addEventListener('keyup', handleKeyUp, true)
      doc.addEventListener('visibilitychange', handleVisibility)
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      if (doc) {
        doc.removeEventListener('keydown', handleKeyDown, true)
        doc.removeEventListener('keyup', handleKeyUp, true)
        doc.removeEventListener('visibilitychange', handleVisibility)
      }
      applyShortcutState(false)
    }
  }, [])

  const readFocusFromLocation = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get('focus')
    } catch {
      return null
    }
  }, [])

  const handleRequestFocus = useCallback((taskId) => {
    if (!taskId) return
    const normalized = String(taskId)
    pendingFocusScrollRef.current = normalized
    setFocusRootId(prev => (prev === normalized ? prev : normalized))
  }, [])

  const focusTaskById = useCallback((taskId, options = {}) => {
    return focusTaskByIdHelper({
      editor,
      taskId,
      forceExpand,
      focusRootRef,
      scheduleApplyStatusFilter,
      options
    })
  }, [editor, forceExpand, scheduleApplyStatusFilter])

  const exitFocus = useCallback(() => {
    if (!focusRootRef.current) return
    pendingFocusScrollRef.current = null
    setFocusRootId(null)
  }, [])

  const computeFocusTitle = useCallback((targetId) => {
    if (!editor || !targetId) return ''
    try {
      const json = editor.getJSON()
      let title = ''
      const visit = (node) => {
        if (!node || !node.content) return false
        for (const child of node.content) {
          if (child.type === 'listItem') {
            const dataId = child.attrs?.dataId
            if (String(dataId) === String(targetId)) {
              const body = child.content || []
              const paragraph = body.find(n => n.type === 'paragraph')
              title = extractTitle(paragraph)
              return true
            }
            for (const nested of child.content || []) {
              if (nested.type === 'bulletList' && visit(nested)) return true
            }
          } else if (child.type === 'bulletList' && visit(child)) {
            return true
          }
        }
        return false
      }
      visit(json)
      return title || ''
    } catch {
      return ''
    }
  }, [editor])

  const updateFocusTitle = useCallback(() => {
    const currentId = focusRootRef.current
    if (!currentId) {
      setFocusTitle('')
      return
    }
    const title = computeFocusTitle(currentId)
    setFocusTitle(title)
  }, [computeFocusTitle])

  // Handle focus request prop
  useEffect(() => {
    if (!focusRequest || !focusRequest.taskId || !editor) return undefined
    const token = focusRequest.token ?? `${focusRequest.taskId}:${focusRequest.remindAt ?? ''}`
    if (lastFocusTokenRef.current === token) return undefined
    lastFocusTokenRef.current = token
    const success = focusTaskById(focusRequest.taskId, { select: focusRequest.select !== false })
    if (success && computeActiveTask && activeTaskInfoRef) {
      const info = computeActiveTask()
      activeTaskInfoRef.current = info
    }
    onFocusHandled?.(success)
  }, [focusRequest, editor, focusTaskById, onFocusHandled, computeActiveTask, activeTaskInfoRef])

  // Cmd/Ctrl-click to focus
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const handler = (event) => {
      if (!(event instanceof MouseEvent)) return
      if (event.type === 'mousedown' && event.button !== 0) return
      const usingModifier = event.metaKey || (event.ctrlKey && !event.metaKey)
      if (!usingModifier) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('a')) return
      const li = target instanceof HTMLElement ? target.closest('li.li-node') : null
      if (!li) return
      const id = li.getAttribute('data-id')
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      handleRequestFocus(String(id))
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('click', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('click', handler, true)
    }
  }, [handleRequestFocus])

  // Popstate handling (browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const next = readFocusFromLocation()
      suppressUrlSyncRef.current = true
      setFocusRootId(next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [readFocusFromLocation])

  // URL sync
  useEffect(() => {
    if (initialFocusSyncRef.current) {
      initialFocusSyncRef.current = false
      return
    }
    if (suppressUrlSyncRef.current) {
      suppressUrlSyncRef.current = false
      return
    }
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      if (focusRootId) url.searchParams.set('focus', focusRootId)
      else url.searchParams.delete('focus')
      window.history.pushState({ focus: focusRootId }, '', url)
    } catch {}
  }, [focusRootId])

  // Body class toggle
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    if (!body) return undefined
    const className = 'focus-mode'
    if (focusRootId) body.classList.add(className)
    else body.classList.remove(className)
    return () => {
      if (focusRootId) body.classList.remove(className)
    }
  }, [focusRootId])

  // Apply collapsed state and filters when focus changes
  useEffect(() => {
    applyCollapsedStateForRoot(focusRootId)
    applyStatusFilter()
  }, [focusRootId, applyCollapsedStateForRoot, applyStatusFilter])

  // Scroll to focused item
  useEffect(() => {
    if (!focusRootId) return
    if (!editor || !editor.view || !editor.view.dom) return
    scrollToFocusedTask({
      editor,
      targetId: focusRootId,
      pendingFocusScrollRef,
      focusRootId
    })
  }, [focusRootId, editor])

  // Update title when editor updates
  useEffect(() => {
    if (!editor) return
    const handler = () => updateFocusTitle()
    editor.on('update', handler)
    updateFocusTitle()
    return () => editor.off('update', handler)
  }, [editor, updateFocusTitle])

  // Update title when focus changes
  useEffect(() => {
    updateFocusTitle()
  }, [focusRootId, updateFocusTitle])

  const focusDisplayTitle = focusTitle?.trim() ? focusTitle.trim() : 'Untitled task'
  const focusContextValue = useMemo(() => ({
    focusRootId,
    requestFocus: handleRequestFocus,
    exitFocus,
    loadCollapsedSet: loadCollapsedSetForRoot,
    saveCollapsedSet: saveCollapsedSetForRoot,
    forceExpand
  }), [focusRootId, handleRequestFocus, exitFocus, forceExpand])

  return {
    focusRootId,
    setFocusRootId,
    focusRootRef,
    focusTitle,
    focusDisplayTitle,
    focusContextValue,
    handleRequestFocus,
    exitFocus,
    focusTaskById,
    pendingFocusScrollRef,
    suppressUrlSyncRef
  }
}
