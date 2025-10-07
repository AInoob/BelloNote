import { DecorationSet } from 'prosemirror-view'
import { clamp } from '../../utils/range.js'

export function buildBlockDecorationSet(doc, collect) {
  const decorations = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const blockDecorations = collect(node, pos) || []
    if (blockDecorations.length) decorations.push(...blockDecorations)
  })
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

export function patchBlockDecorationSet({ decoSet, doc, ranges, collect, beforeCollect }) {
  if (!ranges?.length) return decoSet
  let next = decoSet
  const processed = new Set()
  const docSize = doc.content.size
  ranges.forEach(([from, to]) => {
    const start = clamp(Math.min(from, to), 0, docSize)
    const end = clamp(Math.max(from, to), 0, docSize)
    doc.nodesBetween(Math.max(0, start - 1), Math.min(docSize, end + 1), (node, pos) => {
      if (!node.isTextblock) return
      if (processed.has(pos)) return false
      if (beforeCollect && beforeCollect(node, pos) === false) return
      processed.add(pos)
      const blockFrom = pos
      const blockTo = pos + node.nodeSize
      const existing = next.find(blockFrom, blockTo)
      if (existing.length) next = next.remove(existing)
      const blockDecorations = collect(node, pos) || []
      if (blockDecorations.length) next = next.add(doc, blockDecorations)
      return false
    })
  })
  return next
}
