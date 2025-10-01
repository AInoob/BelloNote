import { TextSelection } from 'prosemirror-state'
import { cssEscape } from '../../utils/cssEscape.js'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './collapsedState.js'

/**
 * Handle request to focus on a task
 * @param {string} taskId - Task ID to focus on
 * @param {Function} setPendingFocusScroll - Function to set pending focus scroll
 * @param {Function} setFocusRootId - Function to set focus root ID
 */
export function handleRequestFocus(taskId, setPendingFocusScroll, setFocusRootId) {
  if (!taskId) return
  const normalized = String(taskId)
  setPendingFocusScroll(normalized)
  setFocusRootId(prev => (prev === normalized ? prev : normalized))
}

/**
 * Focus on a task by ID
 * @param {Object} editor - TipTap editor instance
 * @param {string} taskId - Task ID to focus on
 * @param {Object} options - Focus options
 * @param {boolean} options.select - Whether to select the task (default: true)
 * @param {boolean} forceExpand - Whether to force expand all nodes
 * @param {Object} focusRootRef - Ref to focus root ID
 * @returns {boolean} True if focus was successful, false otherwise
 */
export function focusTaskById(editor, taskId, { select = true } = {}, forceExpand, focusRootRef) {
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
    requestAnimationFrame(() => {
      requestAnimationFrame(centerTask)
    })
    return true
  } catch (err) {
    console.error('[outline] focus failed', err)
    return false
  }
}

/**
 * Exit focus mode
 * @param {Function} setFocusRootId - Function to set focus root ID
 * @param {Object} suppressUrlSyncRef - Ref to suppress URL sync
 */
export function exitFocus(setFocusRootId, suppressUrlSyncRef) {
  suppressUrlSyncRef.current = true
  setFocusRootId(null)
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('focus')
      window.history.replaceState({}, '', url)
    } catch {}
  }
}

/**
 * Compute the title of the focused task
 * @param {string} targetId - Target task ID
 * @param {Object} editor - TipTap editor instance
 * @param {Function} extractTitle - Function to extract title from paragraph
 * @returns {string|null} Title of the focused task or null
 */
export function computeFocusTitle(targetId, editor, extractTitle) {
  if (!targetId || !editor) return null
  try {
    const json = editor.getJSON()
    let title = null
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
    return title
  } catch {
    return null
  }
}

/**
 * Update the focus title state
 * @param {string} focusRootId - Focus root ID
 * @param {Object} editor - TipTap editor instance
 * @param {Function} extractTitle - Function to extract title from paragraph
 * @param {Function} setFocusTitle - Function to set focus title
 */
export function updateFocusTitle(focusRootId, editor, extractTitle, setFocusTitle) {
  if (!focusRootId) {
    setFocusTitle(null)
    return
  }
  const title = computeFocusTitle(focusRootId, editor, extractTitle)
  setFocusTitle(title)
}

