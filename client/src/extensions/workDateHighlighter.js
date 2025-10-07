import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { clamp, collectChangedTextblockRanges } from '../utils/range.js'
import { buildBlockDecorationSet, patchBlockDecorationSet } from './utils/blockDecorations.js'

const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const workDateKey = new PluginKey('workDateHighlighter')

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
  return buildBlockDecorationSet(doc, (node, pos) => collectBlockDecorations(node, pos))
}

function patchDecos(decoSet, doc, ranges) {
  return patchBlockDecorationSet({
    decoSet,
    doc,
    ranges,
    collect: (node, pos) => collectBlockDecorations(node, pos)
  })
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
