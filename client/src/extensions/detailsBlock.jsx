
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from 'lowlight/lib/core.js'
import React, { useEffect, useState } from 'react'
import { getTask, updateTask, uploadImage } from '../api.js'

function nearestListItemId(editor, getPos) {
  try {
    const pos = getPos()
    const $pos = editor.state.doc.resolve(pos)
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'listItem') return node.attrs?.dataId || null
    }
  } catch {}
  return null
}

const DetailsView = (props) => {
  const { node, updateAttributes, editor, getPos } = props
  const open = !!node.attrs.open
  const [taskId, setTaskId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setTaskId(nearestListItemId(editor, getPos)) }, [])

  const detailsEditor = useEditor({
    extensions: [StarterKit, Image.configure({ inline:false, allowBase64:true }), CodeBlockLowlight.configure({ lowlight })],
    content: '<p></p>',
    onUpdate: async ({ editor: ed }) => {
      if (!taskId || String(taskId).startsWith('new-')) return
      setSaving(true)
      await updateTask(taskId, { content: ed.getHTML() })
      setSaving(false)
    }
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!open || !taskId || String(taskId).startsWith('new-')) return
      const t = await getTask(taskId)
      if (!cancelled) detailsEditor?.commands.setContent(t.content || '<p></p>')
    }
    load()
    return () => { cancelled = true }
  }, [open, taskId])

  return (
    <NodeViewWrapper className="details-block">
      <button className="details-pill" onClick={() => updateAttributes({ open: !open })}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && (
        <div className="details-panel">
          <div className="save-indicator" style={{ marginBottom: 6 }}>{saving ? 'Saving…' : 'Auto-saved'}</div>
          <EditorContent editor={detailsEditor} className="tiptap" />
          <div style={{ display:'flex', gap:8, marginTop:6 }}>
            <button className="btn" onClick={async () => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = async () => {
                const file = input.files[0]
                if (!file) return
                const { url } = await uploadImage(file)
                detailsEditor.chain().focus().setImage({ src: url }).run()
              }
              input.click()
            }}>Upload image</button>
            <button className="btn" onClick={() => detailsEditor.chain().focus().toggleCodeBlock().run()}>Code block</button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const DetailsBlock = Node.create({
  name: 'detailsBlock',
  group: 'block',
  content: '',
  selectable: false,
  atom: true,
  addAttributes() { return { open: { default: false } } },
  parseHTML() { return [{ tag: 'div[data-details-block]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-details-block': '' }), 0] },
  addNodeView() { return ReactNodeViewRenderer(DetailsView) }
})
