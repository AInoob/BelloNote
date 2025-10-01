import { useCallback } from 'react'

/**
 * Custom hook to apply collapsed state for a root task
 * @param {Object} editor - TipTap editor instance
 * @param {boolean} forceExpand - Whether to force expand all tasks
 * @param {Function} loadCollapsedSetForRoot - Function to load collapsed set for root
 * @returns {Function} Function to apply collapsed state for root
 */
export function useCollapsedStateApplier(editor, forceExpand, loadCollapsedSetForRoot) {
  const applyCollapsedStateForRoot = useCallback((rootId) => {
    if (!editor) return
    const collapsedSet = forceExpand ? new Set() : loadCollapsedSetForRoot(rootId)
    const { state, view } = editor
    if (!state || !view) return
    let tr = state.tr
    let mutated = false
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return
      const dataId = node.attrs.dataId
      if (!dataId) return
      const shouldCollapse = collapsedSet.has(String(dataId))
      if (!!node.attrs.collapsed !== shouldCollapse) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: shouldCollapse })
        mutated = true
      }
    })
    if (mutated) {
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    }
  }, [editor, forceExpand, loadCollapsedSetForRoot])

  return applyCollapsedStateForRoot
}

