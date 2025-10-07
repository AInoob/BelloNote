/**
 * Create a reminder action handler
 * @param {string} action - Action type ('schedule', 'dismiss', 'complete', 'remove')
 * @param {Function} ensurePersistentTaskId - Function to ensure task has persistent ID
 * @param {Function} closeReminderMenu - Function to close reminder menu
 * @param {Function} setReminderError - Function to set reminder error
 * @param {boolean} reminderControlsEnabled - Whether reminder controls are enabled
 * @param {Object} options - Additional options
 * @param {string} options.customDate - Custom date for schedule action
 * @returns {Function} Handler function
 */
import { TextSelection } from 'prosemirror-state'

export function dispatchReminderAction(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('worklog:reminder-action', { detail }))
}

export function createReminderActionHandler(
  action,
  ensurePersistentTaskId,
  closeReminderMenu,
  setReminderError,
  reminderControlsEnabled,
  options = {}
) {
  return async () => {
    if (!reminderControlsEnabled) return
    try {
      const realId = await ensurePersistentTaskId()
      const detail = { action, taskId: String(realId) }
      
      if (action === 'schedule' && options.customDate) {
        detail.remindAt = options.customDate
      }
      
      dispatchReminderAction(detail)
      closeReminderMenu()
    } catch (err) {
      const errorMessages = {
        schedule: 'Failed to schedule reminder',
        dismiss: 'Unable to dismiss reminder',
        complete: 'Unable to mark complete',
        remove: 'Unable to remove reminder'
      }
      setReminderError(err?.message || errorMessages[action] || 'Action failed')
    }
  }
}

export function buildReminderActionSet({
  ensurePersistentTaskId,
  closeReminderMenu,
  setReminderError,
  reminderControlsEnabled
}) {
  const factory = (action) => createReminderActionHandler(
    action,
    ensurePersistentTaskId,
    closeReminderMenu,
    setReminderError,
    reminderControlsEnabled
  )
  return {
    dismiss: factory('dismiss'),
    complete: factory('complete'),
    remove: factory('remove')
  }
}

/**
 * Handle status key down event (Enter key to create new task)
 * @param {Event} event - Keyboard event
 * @param {boolean} readOnly - Whether editor is read-only
 * @param {boolean} allowStatusToggleInReadOnly - Whether status toggle is allowed in read-only mode
 * @param {Function} getPos - Function to get node position
 * @param {Object} editor - TipTap editor instance
 * @param {Function} findListItemDepth - Function to find list item depth
 * @param {Function} runSplitListItemWithSelection - Function to split list item
 * @param {Function} applySplitStatusAdjustments - Function to apply split status adjustments
 */
export function handleStatusKeyDown(event, context) {
  const {
    readOnly,
    allowStatusToggleInReadOnly,
    getPos,
    editor,
    findListItemDepth,
    runSplitListItemWithSelection,
    applySplitStatusAdjustments
  } = context
  if (event.key !== 'Enter') return
  if (readOnly && !allowStatusToggleInReadOnly) return
  event.preventDefault()
  event.stopPropagation()
  try {
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos !== 'number' || !editor) return
    const { state, view } = editor
    const resolved = state.doc.resolve(pos)
    const listItemDepth = findListItemDepth(resolved)
    if (listItemDepth === -1) return
    const listItemPos = resolved.before(listItemDepth)
    const listItemNode = state.doc.nodeAt(listItemPos)
    if (!listItemNode || listItemNode.type.name !== 'listItem' || listItemNode.childCount === 0) return
    const paragraphNode = listItemNode.child(0)
    if (!paragraphNode || paragraphNode.type.name !== 'paragraph') return
    const parentDepth = listItemDepth > 0 ? listItemDepth - 1 : null
    const parentPos = parentDepth !== null ? resolved.before(parentDepth) : null
    const originalIndex = resolved.index(listItemDepth)
    const originalAttrs = { ...(listItemNode.attrs || {}) }
    editor.commands.focus()
    const paragraphStart = pos + 1
    const paragraphEnd = paragraphStart + paragraphNode.nodeSize - 1
    const tr = state.tr.setSelection(TextSelection.create(state.doc, paragraphEnd))
    view.dispatch(tr)
    const didSplit = runSplitListItemWithSelection(editor, { splitAtStart: false })
    if (didSplit) {
      applySplitStatusAdjustments(editor, {
        parentPos,
        originalIndex,
        newIndex: originalIndex + 1,
        originalAttrs
      })
    }
  } catch {}
}

function restoreCaretToListItem(editor, getPos, findListItemDepth, options = {}) {
  const { force = false } = options
  if (!editor || typeof getPos !== 'function' || typeof findListItemDepth !== 'function') return
  const targetPos = getPos()
  if (typeof targetPos !== 'number') return
  const run = (attemptForce = force) => {
    try {
      const { state, view } = editor
      if (!view) return
      const node = state.doc.nodeAt(targetPos)
      if (!node || node.type.name !== 'listItem') return
      const selectionInside = state.selection.from >= targetPos && state.selection.to <= (targetPos + node.nodeSize)
      if (!selectionInside && !attemptForce) return
      const innerPos = Math.max(0, Math.min(targetPos + 1, state.doc.content.size))
      const resolved = state.doc.resolve(innerPos)
      const depth = findListItemDepth(resolved)
      if (depth === -1) return
      const listItemPos = resolved.before(depth)
      const listItemNode = state.doc.nodeAt(listItemPos)
      if (!listItemNode || listItemNode.childCount === 0) return
      const paragraph = listItemNode.child(0)
      if (!paragraph || paragraph.type.name !== 'paragraph') return
      const paragraphStart = listItemPos + 1
      const caretPos = paragraphStart + paragraph.content.size
      if (state.selection.from === caretPos && state.selection.to === caretPos) return
      const tr = state.tr.setSelection(TextSelection.create(state.doc, caretPos))
      const listItemDom = typeof view.nodeDOM === 'function' ? view.nodeDOM(listItemPos) : null
      let shouldScroll = true
      if (listItemDom && typeof window !== 'undefined' && typeof listItemDom.getBoundingClientRect === 'function') {
        try {
          const rect = listItemDom.getBoundingClientRect()
          if (!attemptForce && rect && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) {
            const viewportHeight = window.innerHeight || 0
            shouldScroll = !(rect.bottom > 0 && rect.top < viewportHeight)
          }
        } catch {
          shouldScroll = true
        }
      }
      view.dispatch(shouldScroll ? tr.scrollIntoView() : tr)
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[status-toggle] caret restore failed', error)
    }
  }
  run(force)
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => run(false))
    window.setTimeout(() => run(false), 0)
  }
}

/**
 * Cycle through status values
 * @param {Event} event - Click event
 * @param {boolean} readOnly - Whether editor is read-only
 * @param {boolean} allowStatusToggleInReadOnly - Whether status toggle is allowed in read-only mode
 * @param {Object} rowRef - Ref to row element
 * @param {Object} node - ProseMirror node
 * @param {Array} statusOrder - Array of status values in order
 * @param {string} statusEmpty - Empty status value
 * @param {Function} updateAttributes - Function to update node attributes
 * @param {Function} onStatusToggle - Callback for status toggle
 * @param {string} id - Task ID
 * @param {Object} fallbackIdRef - Ref to fallback ID
 * @param {Object} editor - TipTap editor instance
 */
export function cycleStatus(event, context) {
  const {
    readOnly,
    allowStatusToggleInReadOnly,
    rowRef,
    node,
    statusOrder,
    statusEmpty,
    updateAttributes,
    onStatusToggle,
    id,
    fallbackIdRef,
    editor,
    getPos,
    findListItemDepth
  } = context
  if (readOnly && !allowStatusToggleInReadOnly) return
  const li = rowRef.current?.closest('li.li-node')
  const liveStatus = li?.getAttribute('data-status')
  const currentStatus = typeof liveStatus === 'string' ? liveStatus : node?.attrs?.status ?? statusEmpty
  const currentIndex = statusOrder.indexOf(currentStatus)
  const idx = currentIndex >= 0 ? currentIndex : 0
  const next = statusOrder[(idx + 1) % statusOrder.length]
  updateAttributes({ status: next })
  if (readOnly && allowStatusToggleInReadOnly && typeof onStatusToggle === 'function') {
    const realId = id || fallbackIdRef.current
    if (realId) onStatusToggle(String(realId), next)
  }
  if (event?.currentTarget?.blur) {
    try { event.currentTarget.blur() } catch {}
  }

  if (readOnly || !editor || typeof getPos !== 'function') return

  try {
    const { state, view } = editor
    const pos = getPos()
    if (typeof pos !== 'number' || !view) return
    const nodeAtPos = state.doc.nodeAt(pos)
    const selectionInside = Boolean(
      nodeAtPos &&
      nodeAtPos.type?.name === 'listItem' &&
      state.selection.from >= pos &&
      state.selection.to <= (pos + nodeAtPos.nodeSize)
    )
    const forceMove = !selectionInside
    restoreCaretToListItem(editor, getPos, findListItemDepth, { force: forceMove })
    try {
      if (forceMove) {
        view.focus?.()
      } else {
        view.dom?.focus?.({ preventScroll: true })
      }
    } catch {
      view.focus?.()
    }
  } catch {}
}
