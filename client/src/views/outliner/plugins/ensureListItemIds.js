import { Plugin } from 'prosemirror-state'

function rid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {}
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const ensureListItemIds = (schema) => new Plugin({
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some(tr => tr.docChanged)) return

    let tr = newState.tr
    let changed = false
    const liType = schema.nodes.listItem || schema.nodes.list_item
    if (!liType) return

    newState.doc.descendants((node, pos) => {
      if (node.type !== liType) return
      const did = node.attrs?.dataId || node.attrs?.data_id
      if (!did) {
        const attrs = { ...node.attrs, dataId: rid() }
        tr = tr.setNodeMarkup(pos, liType, attrs, node.marks)
        changed = true
      }
    })

    if (changed) return tr
  }
})

