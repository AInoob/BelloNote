import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { TextSelection } from 'prosemirror-state'
import { parseReminderTokenFromText } from '../../utils/reminderTokens.js'
import { extractTitleFromParagraph } from './outlineSerialization.js'

const FOCUS_SHORTCUT_CLASS = 'focus-shortcut-available'

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? performance.now()
  : Date.now()

export function useOutlinerFocus({
  editor,
  forceExpand,
  loadCollapsedSetForRoot,
  saveCollapsedSetForRoot,
  scheduleApplyStatusFilterRef,
  cssEscape,
  focusRequest,
  onFocusHandled,
  focusRootRef: providedFocusRootRef
}) {
  const readFocusFromLocation = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get('focus')
    } catch {
      return null
    }
  }, [])

  const [focusRootId, setFocusRootId] = useState(() => readFocusFromLocation())
  const focusRootRef = providedFocusRootRef ?? useRef(focusRootId)
  useEffect(() => { focusRootRef.current = focusRootId }, [focusRootId])

  const [focusTitle, setFocusTitle] = useState('')
  const suppressUrlSyncRef = useRef(false)
  const initialFocusSyncRef = useRef(true)
  const pendingFocusScrollRef = useRef(null)
  const focusShortcutActiveRef = useRef(false)
  const activeTaskInfoRef = useRef(null)
  const lastFocusTokenRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const applyShortcutState = (active) => {
      if (focusShortcutActiveRef.current === active) return
      focusShortcutActiveRef.current = active
      if (typeof document === 'undefined') return
      const body = document.body
      if (!body) return
      body.classList.toggle(FOCUS_SHORTCUT_CLASS, active)
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

  const computeActiveTask = useCallback(() => {
    if (!editor) return null
    try {
      const { state } = editor
      if (!state) return null
      const { $from } = state.selection
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const node = $from.node(depth)
        if (!node || node.type?.name !== 'listItem') continue
        const dataId = node.attrs?.dataId ? String(node.attrs.dataId) : null
        const reminder = parseReminderTokenFromText(node.textContent || '')
        const textContent = node.textContent || ''
        const dateMatches = textContent.match(/@\d{4}-\d{2}-\d{2}/g) || []
        const dates = Array.from(new Set(dateMatches.map((item) => item.slice(1))))
        const hasDate = dates.length > 0
        const hasReminder = !!reminder
        const reminderDate = reminder?.remindAt ? dayjs(reminder.remindAt).format('YYYY-MM-DD') : null
        return {
          id: dataId,
          hasReminder,
          hasDate,
          dates,
          reminderDate,
          remindAt: reminder?.remindAt || null
        }
      }
    } catch {
      return null
    }
    return null
  }, [editor])

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
              const paragraph = body.find((n) => n.type === 'paragraph')
              title = extractTitleFromParagraph(paragraph)
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
      return title
    } catch {
      return ''
    }
  }, [editor])

  const updateFocusTitle = useCallback(() => {
    if (!focusRootRef.current) {
      setFocusTitle('')
      return
    }
    const title = computeFocusTitle(focusRootRef.current)
    setFocusTitle(title)
  }, [computeFocusTitle])

  const focusDisplayTitle = focusTitle?.trim() ? focusTitle.trim() : 'Untitled task'

  useEffect(() => {
    if (!editor) return
    const handler = () => updateFocusTitle()
    editor.on('update', handler)
    updateFocusTitle()
    return () => editor.off('update', handler)
  }, [editor, updateFocusTitle])

  useEffect(() => {
    updateFocusTitle()
  }, [focusRootId, updateFocusTitle])

  const readFocusFromLocationRef = useRef(readFocusFromLocation)
  useEffect(() => { readFocusFromLocationRef.current = readFocusFromLocation }, [readFocusFromLocation])

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const next = readFocusFromLocationRef.current?.() ?? null
      suppressUrlSyncRef.current = true
      setFocusRootId(next)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleRequestFocus = useCallback((taskId) => {
    if (!taskId) return
    const normalized = String(taskId)
    pendingFocusScrollRef.current = normalized
    setFocusRootId((prev) => (prev === normalized ? prev : normalized))
  }, [])

  const focusTaskById = useCallback((taskId, { select = true } = {}) => {
    if (!editor || !taskId) return false
    try {
      const { state, view } = editor
      if (!state || !view) return false
      const doc = state.doc
      let targetPos = null
      let targetNode = null
      doc.descendants((node, pos) => {
        if (node.type.name === 'listItem' && String(node.attrs.dataId) === String(taskId)) {
          targetPos = pos
          targetNode = node
          return false
        }
        return undefined
      })
      if (targetNode == null || targetPos == null) return false
      const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(focusRootRef.current)
      const expandedIds = new Set()
      const $pos = doc.resolve(targetPos + 1)
      let tr = state.tr
      for (let depth = $pos.depth; depth >= 0; depth -= 1) {
        const node = $pos.node(depth)
        if (!node || node.type?.name !== 'listItem') continue
        const before = $pos.before(depth)
        if (node.attrs?.collapsed) {
          tr = tr.setNodeMarkup(before, undefined, { ...node.attrs, collapsed: false })
        }
        const ancestorId = node.attrs?.dataId
        if (!forceExpand && ancestorId) expandedIds.add(String(ancestorId))
      }
      if (!forceExpand && expandedIds.size) {
        const next = new Set(collapsedSet)
        let changed = false
        expandedIds.forEach((id) => {
          if (next.has(id)) {
            next.delete(id)
            changed = true
          }
        })
        if (changed) saveCollapsedSetForRoot(focusRootRef.current, next)
      }
      if (select) {
        const firstChild = targetNode.childCount > 0 ? targetNode.child(0) : null
        const paragraph = firstChild && firstChild.type?.name === 'paragraph' ? firstChild : null
        const paragraphStart = targetPos + 1
        const selectionPos = paragraph ? paragraphStart + paragraph.nodeSize - 1 : paragraphStart
        tr = tr.setSelection(TextSelection.create(tr.doc, Math.max(paragraphStart, selectionPos)))
      }
      view.dispatch(tr.scrollIntoView())
      view.focus()
      const centerTask = () => {
        if (typeof window === 'undefined') return
        try {
          const rootEl = view.dom
          if (!rootEl) return
          let targetEl = null
          try {
            targetEl = rootEl.querySelector(`li.li-node[data-id="${cssEscape(String(taskId))}"]`)
          } catch {
            targetEl = null
          }
          if (!targetEl) return
          const rect = targetEl.getBoundingClientRect()
          const viewportCenter = window.innerHeight / 2
          const scrollTarget = (rect.top + window.scrollY) - (viewportCenter - rect.height / 2)
          window.scrollTo({ top: Math.max(scrollTarget, 0), behavior: 'smooth' })
          targetEl.classList.add('outline-focus-highlight')
          setTimeout(() => targetEl.classList.remove('outline-focus-highlight'), 1200)
        } catch (err) {
          console.error('[outline] focus scroll failed', err)
        }
      }
      requestAnimationFrame(centerTask)
      scheduleApplyStatusFilterRef?.current?.('focusTaskById')
      return true
    } catch (err) {
      console.error('[outline] failed to focus task', err)
      return false
    }
  }, [cssEscape, editor, forceExpand, loadCollapsedSetForRoot, saveCollapsedSetForRoot, scheduleApplyStatusFilterRef])

  useEffect(() => {
    if (!focusRequest || !focusRequest.taskId || !editor) return undefined
    const token = focusRequest.token ?? `${focusRequest.taskId}:${focusRequest.remindAt ?? ''}`
    if (lastFocusTokenRef.current === token) return undefined
    lastFocusTokenRef.current = token
    const success = focusTaskById(focusRequest.taskId, { select: focusRequest.select !== false })
    if (success) {
      const info = computeActiveTask()
      activeTaskInfoRef.current = info
    }
    onFocusHandled?.(success)
  }, [focusRequest, editor, focusTaskById, onFocusHandled, computeActiveTask])

  const requestFocusRef = useRef(handleRequestFocus)
  useEffect(() => { requestFocusRef.current = handleRequestFocus }, [handleRequestFocus])

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
      requestFocusRef.current?.(String(id))
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('click', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('click', handler, true)
    }
  }, [])

  const exitFocus = useCallback(() => {
    if (!focusRootRef.current) return
    pendingFocusScrollRef.current = null
    setFocusRootId(null)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const body = document.body
    if (!body) return undefined
    const className = 'focus-mode'
    if (focusRootId) body.classList.add(className)
    else body.classList.remove(className)
    return () => {
      if (focusRootId) body.classList.remove(className)
    }
  }, [focusRootId])

  useEffect(() => {
    if (!editor) return undefined
    const handler = () => {
      const info = computeActiveTask()
      const prev = activeTaskInfoRef.current
      const prevKey = prev ? `${prev.id}|${prev.hasReminder}|${prev.hasDate}|${prev.reminderDate}|${(prev.dates || []).join(',')}` : ''
      const nextKey = info ? `${info.id}|${info.hasReminder}|${info.hasDate}|${info.reminderDate}|${(info.dates || []).join(',')}` : ''
      if (prevKey === nextKey) return
      activeTaskInfoRef.current = info
    }
    handler()
    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    return () => {
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
    }
  }, [editor, computeActiveTask])

  return {
    focusRootId,
    setFocusRootId,
    focusContextValue: useMemo(() => ({
      focusRootId,
      requestFocus: handleRequestFocus,
      exitFocus,
      loadCollapsedSet: loadCollapsedSetForRoot,
      saveCollapsedSet: saveCollapsedSetForRoot,
      forceExpand
    }), [focusRootId, handleRequestFocus, exitFocus, forceExpand, loadCollapsedSetForRoot, saveCollapsedSetForRoot]),
    focusDisplayTitle,
    handleRequestFocus,
    focusTaskById,
    exitFocus,
    computeActiveTask,
    activeTaskInfoRef,
    pendingFocusScrollRef,
    suppressUrlSyncRef,
    readFocusFromLocation,
    focusRootRef
  }
}
