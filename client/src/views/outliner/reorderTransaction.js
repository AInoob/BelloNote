/**
 * Move a listItem node via ProseMirror transaction without rebuilding the doc
 * Only supports reorders within the same list depth (matches current drag/drop UX)
 * @param {import('@tiptap/core').Editor} editor
 * @param {{ dragId: string|number, targetId: string|number, place: 'before'|'after' }} params
 * @returns {boolean} Whether the move was applied
 */
export function moveListItemById(editor, { dragId, targetId, place }) {
  if (!editor || !dragId || !targetId || place == null) return false
  const { state, view } = editor
  if (!state || !view) return false
  const { doc, schema } = state
  const listItemType = schema.nodes.listItem
  if (!listItemType) return false

  let dragPos = -1
  let dragNode = null
  let dragDepth = -1
  let targetPos = -1
  let targetDepth = -1

  doc.descendants((node, pos) => {
    if (node.type !== listItemType) return true
    const attrId = node.attrs?.dataId || node.attrs?.data_id || node.attrs?.id
    if (attrId != null) {
      const sid = String(attrId)
      if (sid === String(dragId)) {
        dragPos = pos
        dragNode = node
        dragDepth = doc.resolve(pos).depth
      }
      if (sid === String(targetId)) {
        targetPos = pos
        targetDepth = doc.resolve(pos).depth
      }
    }
    return true
  })

  if (dragPos < 0 || targetPos < 0 || !dragNode) return false
  if (dragDepth !== targetDepth) return false

  const dragEnd = dragPos + dragNode.nodeSize
  let tr = state.tr.delete(dragPos, dragEnd)

  const mappedTarget = tr.mapping.map(targetPos)
  const targetNode = tr.doc.nodeAt(mappedTarget)
  if (!targetNode || targetNode.type !== listItemType) return false

  const insertPos = place === 'after'
    ? mappedTarget + targetNode.nodeSize
    : mappedTarget

  tr = tr.insert(insertPos, dragNode)
  tr.setMeta('addToHistory', true)
  view.dispatch(tr)
  return true
}
