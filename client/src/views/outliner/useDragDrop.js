// ============================================================================
// Drag and Drop Hook
// Handles drag-and-drop reordering of outline items
// ============================================================================

import { useEffect } from 'react'
import { parseOutline, buildList, moveNodeInOutline } from './outlineUtils.js'

export function useDragDrop({
  editor,
  isReadOnly,
  draggingRef,
  normalizeImageSrc,
  pushDebug,
  forceExpand,
  markDirty,
  queueSave,
  applyStatusFilter
}) {
  useEffect(() => {
    if (!editor || isReadOnly) return
    const dom = editor.view.dom

    const handleDragOver = (event) => {
      if (!draggingRef.current) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }

    const handleDrop = (event) => {
      const drag = draggingRef.current
      if (!drag) return
      event.preventDefault()
      const dragEl = drag.element
      const pointerY = event.clientY
      const dragList = dragEl ? dragEl.closest('ul') : null
      const candidates = Array.from(dom.querySelectorAll('li.li-node'))
        .filter(el => el !== dragEl && (!dragList || el.closest('ul') === dragList))
      let chosen = null
      let dropAfter = false

      const getDepth = (el) => {
        let depth = 0
        let cur = el.parentElement
        while (cur) {
          if (cur.matches && cur.matches('li.li-node')) depth += 1
          cur = cur.parentElement
        }
        return depth
      }

      const infos = candidates.map(el => ({ el, rect: el.getBoundingClientRect(), depth: getDepth(el) }))
        .filter(info => info.rect.height > 0)
        .sort((a, b) => a.rect.top - b.rect.top)
      const inside = infos.filter(info => pointerY >= info.rect.top && pointerY <= info.rect.bottom)

      if (inside.length) {
        inside.sort((a, b) => b.depth - a.depth)
        const pick = inside[0]
        const mid = pick.rect.top + (pick.rect.height / 2)
        chosen = pick.el
        dropAfter = pointerY > mid
      } else {
        const below = infos.find(info => pointerY < info.rect.top)
        if (below) {
          chosen = below.el
          dropAfter = false
        } else if (infos.length) {
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

      const outline = parseOutline(editor, { normalizeImageSrc, pushDebug })
      console.log('[drop] request', {
        dragId: drag.id,
        targetId,
        dropAfter,
        pointerY,
        chosenBounds: chosen ? (() => {
          const rect = chosen.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2 }
        })() : null
      })

      const moved = moveNodeInOutline(outline, drag.id, targetId, dropAfter ? 'after' : 'before')
      draggingRef.current = null
      if (!moved) return

      console.log('[drop] move applied', { order: moved.map(n => n.id) })
      const docJSON = { type: 'doc', content: [buildList(moved, { forceExpand, normalizeImageSrc })] }
      editor.commands.setContent(docJSON)
      markDirty()
      queueSave(300)
      applyStatusFilter()
    }

    dom.addEventListener('dragover', handleDragOver)
    dom.addEventListener('drop', handleDrop)
    return () => {
      dom.removeEventListener('dragover', handleDragOver)
      dom.removeEventListener('drop', handleDrop)
    }
  }, [editor, isReadOnly, draggingRef, normalizeImageSrc, pushDebug, forceExpand, markDirty, queueSave, applyStatusFilter])
}
