// ============================================================================
// Focus Task Helper Functions
// Functions for focusing, scrolling to, and highlighting tasks
// ============================================================================

import { TextSelection } from 'prosemirror-state'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './focusCollapsedStorage.js'

const cssEscape = (value) => {
  if (typeof value !== 'string') value = String(value ?? '')
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9\\-_]/g, (match) => `\\\\${match}`)
}

/**
 * Focuses a task by ID, expanding collapsed ancestors and scrolling to it
 * @param {Object} params - Parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {string|number} params.taskId - Task ID to focus
 * @param {boolean} params.forceExpand - Whether to force expand all items
 * @param {Object} params.focusRootRef - Ref containing current focus root ID
 * @param {Function} params.scheduleApplyStatusFilter - Function to schedule status filter
 * @param {Object} [params.options={}] - Options
 * @param {boolean} [params.options.select=true] - Whether to select the task
 * @returns {boolean} True if successfully focused
 */
export function focusTaskById({
  editor,
  taskId,
  forceExpand,
  focusRootRef,
  scheduleApplyStatusFilter,
  options = {}
}) {
  const { select = true } = options
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
    let mutated = false
    for (let depth = $pos.depth; depth >= 0; depth -= 1) {
      const node = $pos.node(depth)
      if (!node || node.type?.name !== 'listItem') continue
      const before = $pos.before(depth)
      if (node.attrs?.collapsed) {
        tr = tr.setNodeMarkup(before, undefined, { ...node.attrs, collapsed: false })
        mutated = true
      }
      const ancestorId = node.attrs?.dataId
      if (!forceExpand && ancestorId) expandedIds.add(String(ancestorId))
    }
    if (!forceExpand && expandedIds.size) {
      const next = new Set(collapsedSet)
      let changed = false
      expandedIds.forEach(id => {
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
    scheduleApplyStatusFilter('focusTaskById')
    return true
  } catch (err) {
    console.error('[outline] failed to focus task', err)
    return false
  }
}

/**
 * Scrolls to a focused task without changing selection
 * @param {Object} params - Parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {string} params.targetId - Task ID to scroll to
 * @param {Object} params.pendingFocusScrollRef - Ref tracking pending scroll
 * @param {string} params.focusRootId - Current focus root ID
 */
export function scrollToFocusedTask({
  editor,
  targetId,
  pendingFocusScrollRef,
  focusRootId
}) {
  if (!editor || !editor.view || !editor.view.dom) return
  const runScroll = () => {
    try {
      const rootEl = editor.view.dom
      let targetEl = null
      try {
        targetEl = rootEl.querySelector(`li.li-node[data-id="${cssEscape(String(targetId))}"]`)
      } catch {
        targetEl = null
      }
      if (!targetEl) return
      const rect = targetEl.getBoundingClientRect()
      const viewportHeight = window.innerHeight || 0
      const desired = Math.max(0, (rect.top + window.scrollY) - Math.max(0, (viewportHeight / 2) - (rect.height / 2)))
      window.scrollTo({ top: desired, behavior: 'smooth' })
    } finally {
      pendingFocusScrollRef.current = null
    }
  }
  const requestedId = pendingFocusScrollRef.current
  if (requestedId && requestedId !== focusRootId) {
    pendingFocusScrollRef.current = focusRootId
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(runScroll)
  })
}
