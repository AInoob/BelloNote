import { NodeSelection } from 'prosemirror-state'

/**
 * Handle drag start event for a task list item
 * @param {DragEvent} event - Drag event
 * @param {boolean} readOnly - Whether the editor is read-only
 * @param {string|null} id - Task ID
 * @param {Object} fallbackIdRef - Ref to fallback ID
 * @param {Function} updateAttributes - Function to update node attributes
 * @param {Function} getPos - Function to get node position
 * @param {Object} editor - TipTap editor instance
 * @param {Object} draggingRef - Ref to dragging state
 * @param {Object} justDraggedRef - Ref to just dragged state
 */
export function handleDragStart(
  event,
  readOnly,
  id,
  fallbackIdRef,
  updateAttributes,
  getPos,
  editor,
  draggingRef,
  justDraggedRef
) {
  if (readOnly) return
  try {
    justDraggedRef.current = true
    let currentId = id ? String(id) : fallbackIdRef.current
    if (!currentId) {
      currentId = 'new-' + Math.random().toString(36).slice(2, 8)
      updateAttributes({ dataId: currentId })
    }
    fallbackIdRef.current = currentId
    const pos = getPos()
    const view = editor.view
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
    view.dispatch(tr)
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', ' ')
      event.dataTransfer.effectAllowed = 'move'
    }
    view.dragging = { slice: view.state.selection.content(), move: true }
    if (event.currentTarget instanceof HTMLElement) {
      const wrapper = event.currentTarget.closest('li.li-node')
      if (wrapper) wrapper.setAttribute('data-id', currentId)
    }
    if (draggingRef) {
      draggingRef.current = {
        id: currentId,
        element: event.currentTarget instanceof HTMLElement
          ? event.currentTarget.closest('li.li-node')
          : null
      }
    }
  } catch (e) {
    console.error('[drag] failed to select node', e)
  }
}

/**
 * Handle drag end event for a task list item
 * @param {boolean} readOnly - Whether the editor is read-only
 * @param {Object} draggingRef - Ref to dragging state
 * @param {Object} editor - TipTap editor instance
 * @param {Object} justDraggedRef - Ref to just dragged state
 */
export function handleDragEnd(readOnly, draggingRef, editor, justDraggedRef) {
  if (readOnly) return
  if (draggingRef) draggingRef.current = null
  if (editor?.view) editor.view.dragging = null
  setTimeout(() => { justDraggedRef.current = false }, 0)
}

