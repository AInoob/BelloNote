
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
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
  const isOpen = !!node?.attrs?.open
  const [taskId, setTaskId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [extensions, setExtensions] = useState(null)
  const convertingImagesRef = useRef(false)
  const pendingImagesRef = useRef(new Set())
  const taskIdRef = useRef(null)

  useEffect(() => { setTaskId(nearestListItemId(editor, getPos)) }, [])
  useEffect(() => { taskIdRef.current = taskId }, [taskId])

  useEffect(() => {
    if (!isOpen || extensions) return
    let cancelled = false
    ;(async () => {
      try {
        const [{ default: CodeBlockLowlight }, { lowlight }] = await Promise.all([
          import('@tiptap/extension-code-block-lowlight'),
          import('lowlight/lib/core.js')
        ])
        if (cancelled) return
        setExtensions([
          StarterKit,
          ImageWithMeta.configure({ inline: false, allowBase64: true }),
          CodeBlockLowlight.configure({ lowlight })
        ])
      } catch (err) {
        console.error('[details] failed to load editor extensions', err)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, extensions])

  useEffect(() => {
    if (!isOpen) setSaving(false)
  }, [isOpen])

  const detailsEditor = useEditor(
    isOpen && extensions
      ? {
          extensions,
          content: '<p></p>',
          onUpdate: async ({ editor: ed }) => {
            const currentTaskId = taskIdRef.current
            if (!currentTaskId || String(currentTaskId).startsWith('new-')) return
            setSaving(true)
            try {
              await updateTask(currentTaskId, { content: ed.getHTML() })
            } catch (err) {
              console.error('[details] failed to save content', err)
            } finally {
              setSaving(false)
            }
          }
        }
      : null,
    [extensions, isOpen]
  )

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
    if (!isOpen || !detailsEditor) return undefined
    if (!taskId || String(taskId).startsWith('new-')) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const task = await getTask(taskId)
        if (!cancelled) detailsEditor.commands.setContent(task.content || '<p></p>')
      } catch (err) {
        console.error('[details] failed to load content', err)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, taskId, detailsEditor])

  return (
    <NodeViewWrapper className="details-block">
      <button className="details-pill" onClick={() => updateAttributes({ open: !isOpen })}>
        {isOpen ? 'Hide details' : 'Details'}
      </button>
      {isOpen && (
        <div className="details-panel">
          {!detailsEditor && (
            <div className="save-indicator" style={{ marginBottom: 6 }}>Loading…</div>
          )}
          {detailsEditor && (
            <>
              <div className="save-indicator" style={{ marginBottom: 6 }}>{saving ? 'Saving…' : 'Auto-saved'}</div>
              <EditorContent editor={detailsEditor} className="tiptap" />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  className="btn"
                  disabled={!detailsEditor}
                  onClick={async () => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/*'
                    input.onchange = async () => {
                      const file = input.files[0]
                      if (!file) return
                      try {
                        const result = await uploadImage(file)
                        const attrs = { src: absoluteUrl(result.url) }
                        if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
                        if (result?.id) attrs['data-file-id'] = result.id
                        detailsEditor.chain().focus().setImage(attrs).run()
                      } catch (err) {
                        console.error('[details] failed to upload image', err)
                      }
                    }
                    input.click()
                  }}
                >
                  Upload image
                </button>
                <button
                  className="btn"
                  disabled={!detailsEditor}
                  onClick={() => detailsEditor.chain().focus().toggleCodeBlock().run()}
                >
                  Code block
                </button>
              </div>
            </>
          )}
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
