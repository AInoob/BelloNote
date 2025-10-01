// ============================================================================
// Collapse State Helpers
// Functions for managing collapsed state across the editor
// ============================================================================

import { loadCollapsedSetForRoot } from './filterUtils.js'

export const applyCollapsedStateForRoot = (editor, rootId, forceExpand) => {
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
}
