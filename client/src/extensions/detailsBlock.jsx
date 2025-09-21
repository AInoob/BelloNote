
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from 'lowlight/lib/core.js'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { getTask, updateTask, uploadImage, absoluteUrl } from '../api.js'
import { ImageWithMeta } from './imageWithMeta.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'

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
  const convertingImagesRef = useRef(false)
  const pendingImagesRef = useRef(new Set())

  useEffect(() => { setTaskId(nearestListItemId(editor, getPos)) }, [])

  const detailsEditor = useEditor({
    extensions: [StarterKit, ImageWithMeta.configure({ inline:false, allowBase64:true }), CodeBlockLowlight.configure({ lowlight })],
    content: '<p></p>',
    onUpdate: async ({ editor: ed }) => {
      if (!taskId || String(taskId).startsWith('new-')) return
      setSaving(true)
      await updateTask(taskId, { content: ed.getHTML() })
      setSaving(false)
    }
  })

  const ensureUploadedImages = useCallback(async () => {
    if (!detailsEditor || convertingImagesRef.current) return
    convertingImagesRef.current = true
    try {
      const queue = []
      detailsEditor.state.doc.descendants((node, pos) => {
        if (node.type?.name !== 'image') return
        const src = node.attrs?.src
        if (!src || !isDataUri(src) || pendingImagesRef.current.has(src)) return
        queue.push({ pos, src })
        pendingImagesRef.current.add(src)
      })
      for (const item of queue) {
        const payload = dataUriToFilePayload(item.src, 'details')
        if (!payload) {
          pendingImagesRef.current.delete(item.src)
          continue
        }
        try {
          const result = await uploadImage(payload.file, payload.name)
          const { state, view } = detailsEditor
          const node = state.doc.nodeAt(item.pos)
          if (!node || node.type?.name !== 'image') continue
          const attrs = { ...node.attrs }
          attrs.src = absoluteUrl(result.url)
          if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
          if (result?.id) attrs['data-file-id'] = result.id
          view.dispatch(state.tr.setNodeMarkup(item.pos, undefined, attrs))
        } catch (err) {
          console.error('[details] failed to upload pasted image', err)
        } finally {
          pendingImagesRef.current.delete(item.src)
        }
      }
    } finally {
      convertingImagesRef.current = false
    }
  }, [detailsEditor])

  useEffect(() => {
    if (!detailsEditor) return
    const handler = () => { ensureUploadedImages() }
    detailsEditor.on('update', handler)
    ensureUploadedImages()
    return () => { detailsEditor.off('update', handler) }
  }, [detailsEditor, ensureUploadedImages])

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
                const result = await uploadImage(file)
                const attrs = { src: absoluteUrl(result.url) }
                if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
                if (result?.id) attrs['data-file-id'] = result.id
                detailsEditor.chain().focus().setImage(attrs).run()
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
