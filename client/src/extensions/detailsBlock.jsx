
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from 'lowlight/lib/core.js'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { getTask, updateTask, uploadImage, absoluteUrl } from '../api.js'
import { ImageWithMeta } from './imageWithMeta.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'
import { applyPlaywrightImageFallback, isPlaywrightTestEnvironment } from '../utils/imageFallback.js'

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
          const resolvedSrc = absoluteUrl(result.url)
          attrs.src = applyPlaywrightImageFallback(resolvedSrc)
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

  const sanitizeHtmlContent = useCallback((html) => {
    if (typeof html !== 'string' || !html) return html
    if (!isPlaywrightTestEnvironment()) return html

    const normalizeSrc = (value) => applyPlaywrightImageFallback(value || '')

    if (typeof window !== 'undefined' && typeof window.DOMParser === 'function') {
      try {
        const parser = new window.DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        doc?.querySelectorAll('img[src]').forEach((img) => {
          const original = img.getAttribute('src')
          if (original) img.setAttribute('src', normalizeSrc(original))
        })
        return doc?.body?.innerHTML ?? html
      } catch {
        // Fallback to regex below if DOM parsing fails
      }
    }

    const replaceQuotedSrc = /(<img[^>]*?\bsrc\s*=\s*)(['"])([\s\S]*?)(\2)/gi
    const replaceBareSrc = /(<img[^>]*?\bsrc\s*=\s*)(?!['"])([^\s>]+)/gi

    let transformed = html.replace(replaceQuotedSrc, (match, prefix, quote, value) => {
      const sanitized = normalizeSrc(value.trim())
      return `${prefix}${quote}${sanitized}${quote}`
    })

    transformed = transformed.replace(replaceBareSrc, (match, prefix, value) => {
      const sanitized = normalizeSrc(value.trim())
      return `${prefix}${sanitized}`
    })

    return transformed
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!open || !taskId || String(taskId).startsWith('new-')) return
      const t = await getTask(taskId)
      if (!cancelled) {
        const content = sanitizeHtmlContent(t.content || '<p></p>')
        detailsEditor?.commands.setContent(content || '<p></p>')
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, taskId, detailsEditor, sanitizeHtmlContent])

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
                const resolvedSrc = absoluteUrl(result.url)
                const attrs = { src: applyPlaywrightImageFallback(resolvedSrc) }
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
