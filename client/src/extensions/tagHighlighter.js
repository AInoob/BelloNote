import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { TAG_SCAN_RE } from '../views/outliner/constants.js'
import { collectChangedTextblockRanges } from '../utils/range.js'
import { buildBlockDecorationSet, patchBlockDecorationSet } from './utils/blockDecorations.js'

const tagHighlightKey = new PluginKey('tagHighlighter')

function collectTextPieces(node) {
  const pieces = []
  node.forEach((child, offset) => {
    if (!child.isText) return
    const text = child.text || ''
    if (!text) return
    pieces.push({ text, offset })
  })
  return pieces
}

function collectTagDecorations(node, pos) {
  if (node.type?.name === 'codeBlock') return []
  const pieces = collectTextPieces(node)
  if (!pieces.length) return []
  const blockText = pieces.map((piece) => piece.text).join('')
  if (!blockText.includes('#')) return []
  const decorations = []
  TAG_SCAN_RE.lastIndex = 0
  let match
  while ((match = TAG_SCAN_RE.exec(blockText)) !== null) {
    const prefix = match[1] || ''
    const rawTag = match[2] || ''
    if (!rawTag) continue
    const start = match.index + prefix.length
    const end = start + rawTag.length + 1
    const lower = rawTag.toLowerCase()
    let accumulated = 0
    for (const piece of pieces) {
      const pieceStart = accumulated
      const pieceEnd = pieceStart + piece.text.length
      if (pieceEnd <= start) {
        accumulated = pieceEnd
        continue
      }
      if (pieceStart >= end) break
      const segmentStart = Math.max(start, pieceStart)
      const segmentEnd = Math.min(end, pieceEnd)
      if (segmentEnd > segmentStart) {
        const from = pos + 1 + piece.offset + (segmentStart - pieceStart)
        const to = from + (segmentEnd - segmentStart)
        decorations.push(Decoration.inline(from, to, {
          class: 'tag-inline-badge',
          'data-tag': lower
        }))
      }
      accumulated = pieceEnd
      if (accumulated >= end) break
    }
  }
  return decorations
}

function buildDecos(doc) {
  return buildBlockDecorationSet(doc, (node, pos) => collectTagDecorations(node, pos))
}

function patchDecos(decoSet, doc, ranges) {
  return patchBlockDecorationSet({
    decoSet,
    doc,
    ranges,
    collect: (node, pos) => collectTagDecorations(node, pos)
  })
}

export const TagHighlighter = Extension.create({
  name: 'tagHighlighter',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagHighlightKey,
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
      })
    ]
  }
})
