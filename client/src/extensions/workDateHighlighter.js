// ============================================================================
// Work Date Highlighter Extension
// TipTap extension for highlighting @YYYY-MM-DD date tags in editor
// ============================================================================

import { Extension } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/** Regex pattern for matching date tags in format @YYYY-MM-DD */
const DATE_RE = /@\d{4}-\d{2}-\d{2}/g

/**
 * WorkDateHighlighter TipTap Extension
 * Applies CSS class 'work-date' to date tags for visual highlighting
 */
export const WorkDateHighlighter = Extension.create({
  name: 'workDateHighlighter',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        /**
         * Creates decorations for all date tags in the document
         * @param {EditorState} state - ProseMirror editor state
         * @returns {DecorationSet} Set of decorations for date highlights
         */
        decorations(state) {
          const { doc } = state
          const decos = []

          // Walk through all textblocks in the document
          doc.descendants((node, pos) => {
            if (!node.isTextblock) return

            // Gather text content from node
            let text = ''
            node.forEach(n => { if (n.isText) text += n.text })
            if (!text) return

            // Find all date matches in the text
            let m
            DATE_RE.lastIndex = 0
            while ((m = DATE_RE.exec(text)) !== null) {
              const start = m.index
              const end = start + m[0].length
              let offset = 0

              // Map text positions to ProseMirror positions
              node.forEach(nt => {
                if (!nt.isText) return
                const len = (nt.text || '').length
                const ns = offset
                const ne = offset + len
                const s = Math.max(start, ns)
                const e = Math.min(end, ne)
                if (e > s) {
                  decos.push(Decoration.inline(pos + 1 + s, pos + 1 + e, { class: 'work-date' }))
                }
                offset += len
              })
            }
          })

          return DecorationSet.create(doc, decos)
        }
      }
    })]
  }
})
