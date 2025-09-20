
import { Extension } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const DATE_RE = /@\d{4}-\d{2}-\d{2}/g

export const WorkDateHighlighter = Extension.create({
  name: 'workDateHighlighter',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const { doc } = state, decos = []
          doc.descendants((node, pos) => {
            if (!node.isTextblock) return
            let text = ''; node.forEach(n => { if (n.isText) text += n.text })
            if (!text) return
            let m; DATE_RE.lastIndex = 0
            while ((m = DATE_RE.exec(text)) !== null) {
              const start = m.index, end = start + m[0].length
              let offset = 0
              node.forEach(nt => {
                if (!nt.isText) return
                const len = (nt.text || '').length
                const ns = offset, ne = offset + len
                const s = Math.max(start, ns), e = Math.min(end, ne)
                if (e > s) decos.push(Decoration.inline(pos + 1 + s, pos + 1 + e, { class: 'work-date' }))
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
