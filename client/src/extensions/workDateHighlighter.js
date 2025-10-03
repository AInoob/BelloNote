import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const workDateKey = new PluginKey('workDateHighlighter')

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function mergeRanges(ranges) {
  if (!ranges.length) return []
  const sorted = ranges
    .map(([from, to]) => [from, to])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const [from, to] = sorted[i]
    const last = merged[merged.length - 1]
    if (from <= last[1]) {
      last[1] = Math.max(last[1], to)
    } else {
      merged.push([from, to])
    }
  }
  return merged
}

function collectChangedTextblockRanges(tr) {
  const ranges = []
  const { mapping } = tr
  const docSize = tr.doc.content.size
  mapping.maps.forEach((stepMap, index) => {
    const remainder = mapping.slice(index + 1)
    stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
      let from = remainder.map(newStart, -1)
      let to = remainder.map(newEnd, 1)
      if (to < from) [from, to] = [to, from]
      from = clamp(from, 0, docSize)
      to = clamp(to, 0, docSize)
      if (to <= from) {
        from = clamp(from - 1, 0, docSize)
        to = clamp(to + 1, 0, docSize)
        if (to <= from) {
          to = clamp(from + 1, 0, docSize)
        }
      }
      ranges.push([from, to])
    })
  })
  return mergeRanges(ranges)
}

function collectBlockDecorations(node, pos) {
  const textPieces = []
  node.forEach((child, offset) => {
    if (!child.isText) return
    const text = child.text || ''
    if (!text) return
    textPieces.push({ text, offset })
  })
  if (!textPieces.length) return []
  if (!textPieces.some(piece => piece.text.includes('@'))) return []

  const blockText = textPieces.map(piece => piece.text).join('')
  const decorations = []
  DATE_RE.lastIndex = 0
  let match
  while ((match = DATE_RE.exec(blockText)) !== null) {
    const start = match.index
    const end = start + match[0].length
    let accumulated = 0
    for (const piece of textPieces) {
      const pieceStart = accumulated
      const pieceEnd = accumulated + piece.text.length
      const segmentStart = Math.max(start, pieceStart)
      const segmentEnd = Math.min(end, pieceEnd)
      if (segmentEnd > segmentStart) {
        const from = pos + 1 + piece.offset + (segmentStart - pieceStart)
        const to = from + (segmentEnd - segmentStart)
        decorations.push(Decoration.inline(from, to, { class: 'work-date' }))
      }
      accumulated = pieceEnd
    }
  }
  return decorations
}

function buildDecos(doc) {
  const decorations = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const blockDecorations = collectBlockDecorations(node, pos)
    if (blockDecorations.length) decorations.push(...blockDecorations)
  })
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

function patchDecos(decoSet, doc, ranges) {
  if (!ranges.length) return decoSet
  let next = decoSet
  const processed = new Set()
  const docSize = doc.content.size
  ranges.forEach(([from, to]) => {
    const start = clamp(Math.min(from, to), 0, docSize)
    const end = clamp(Math.max(from, to), 0, docSize)
    doc.nodesBetween(Math.max(0, start - 1), Math.min(docSize, end + 1), (node, pos) => {
      if (!node.isTextblock) return
      if (processed.has(pos)) return false
      processed.add(pos)
      const blockFrom = pos
      const blockTo = pos + node.nodeSize
      const existing = next.find(blockFrom, blockTo)
      if (existing.length) next = next.remove(existing)
      const blockDecorations = collectBlockDecorations(node, pos)
      if (blockDecorations.length) next = next.add(doc, blockDecorations)
      return false
    })
  })
  return next
}

export const WorkDateHighlighter = Extension.create({
  name: 'workDateHighlighter',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: workDateKey,
      state: {
        init: (_, { doc }) => buildDecos(doc),
        apply: (tr, oldDecos, _oldState, newState) => {
          const mapped = (oldDecos || DecorationSet.empty).map(tr.mapping, tr.doc)
          if (!tr.docChanged) return mapped
          const changed = collectChangedTextblockRanges(tr)
          if (!changed.length) return mapped
          return patchDecos(mapped, newState.doc, changed)
        }
      },
      props: {
        decorations(state) {
          return this.getState(state)
        }
      }
    })]
  }
})
