import { moveListItemById } from './reorderTransaction.js'
import { stripHighlightMarksFromDoc } from './highlightCleanup.js'

/**
 * Handle drag over event
 * @param {DragEvent} event - Drag event
 * @param {Object} draggingRef - Ref to dragging state
 */
export function handleDragOver(event, draggingRef) {
  if (!draggingRef.current) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

/**
 * Handle drop event
 * @param {DragEvent} event - Drop event
 * @param {Object} draggingRef - Ref to dragging state
 * @param {HTMLElement} dom - Editor DOM element
 * @param {Function} parseOutline - Function to parse outline
 * @param {Function} moveNodeInOutline - Function to move node in outline
 * @param {Function} buildList - Function to build list
 * @param {Object} editor - TipTap editor instance
 * @param {Function} markDirty - Function to mark dirty
 * @param {Function} queueSave - Function to queue save
 * @param {Function} applyStatusFilter - Function to apply status filter
 */
export function handleDrop(
  event,
  draggingRef,
  dom,
  parseOutline,
  moveNodeInOutline,
  buildList,
  editor,
  markDirty,
  queueSave,
  applyStatusFilter
) {
  const drag = draggingRef.current
  if (!drag) return
  event.preventDefault()
  const dragEl = drag.element
  const pointerY = event.clientY
  const dragList = dragEl ? dragEl.closest('ul') : null
  const nodeList = dom.querySelectorAll('li.li-node')
  const candidates = []
  for (let i = 0; i < nodeList.length; i++) {
    const el = nodeList[i]
    if (el === dragEl) continue
    if (dragList && el.closest('ul') !== dragList) continue
    candidates.push(el)
  }
  let chosen = null
  let dropAfter = false
  // Compute depth of an li by counting ancestor lis
  const getDepth = (el) => {
    let depth = 0; let cur = el.parentElement
    while (cur) { if (cur.matches && cur.matches('li.li-node')) depth += 1; cur = cur.parentElement }
    return depth
  }
  const infos = []
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]
    const rect = el.getBoundingClientRect()
    if (!rect || rect.height <= 0) continue
    infos.push({ el, rect, depth: getDepth(el) })
  }
  infos.sort((a, b) => a.rect.top - b.rect.top)
  const inside = infos.filter(info => pointerY >= info.rect.top && pointerY <= info.rect.bottom)
  if (inside.length) {
    // Prefer deepest element under the pointer
    inside.sort((a, b) => b.depth - a.depth)
    const pick = inside[0]
    const mid = pick.rect.top + (pick.rect.height / 2)
    chosen = pick.el
    dropAfter = pointerY > mid
  } else {
    // Find first element below the pointer => drop before it
    const below = infos.find(info => pointerY < info.rect.top)
    if (below) {
      chosen = below.el
      dropAfter = false
    } else if (infos.length) {
      // Otherwise choose the last => drop after it
      chosen = infos[infos.length - 1].el
      dropAfter = true
    }
  }
  const targetId = chosen?.getAttribute('data-id') || null
  if (dragEl && chosen && dragEl.contains(chosen)) {
    console.log('[drop] aborted: target inside drag element', { dragId: drag.id, targetId })
    draggingRef.current = null
    return
  }
  const outline = parseOutline()
  console.log('[drop] request', {
    dragId: drag.id,
    targetId,
    dropAfter,
    pointerY,
    chosenBounds: chosen ? (() => { const rect = chosen.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2 } })() : null
  })
  const place = dropAfter ? 'after' : 'before'
  let reordered = false
  if (targetId) {
    reordered = moveListItemById(editor, { dragId: drag.id, targetId, place })
  }
  draggingRef.current = null
  if (reordered) {
    markDirty()
    queueSave(300)
    applyStatusFilter()
    return
  }

  const moved = moveNodeInOutline(outline, drag.id, targetId, place)
  if (!moved) return
  console.log('[drop] fallback move applied', { order: moved.map(n => n.id) })
  const docJSON = { type: 'doc', content: [buildList(moved)] }
  const cleanDoc = stripHighlightMarksFromDoc(docJSON)
  editor.commands.setContent(cleanDoc)
  markDirty()
  queueSave(300)
  applyStatusFilter()
}
