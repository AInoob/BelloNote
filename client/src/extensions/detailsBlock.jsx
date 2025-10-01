// ============================================================================
// Details Block Extension
// TipTap extension for collapsible details blocks with rich content editing
// ============================================================================

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from 'lowlight/lib/core.js'
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { getTask, updateTask, uploadImage, absoluteUrl } from '../api.js'
import { ImageWithMeta } from './imageWithMeta.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Finds the nearest parent list item's ID
 * @param {Editor} editor - TipTap editor instance
 * @param {Function} getPos - Function to get node position
 * @returns {string|null} List item ID or null
 */
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

/**
 * DetailsView Component
 * React NodeView for rendering collapsible details blocks with nested editor
 * @param {Object} props - Component props
 * @param {Node} props.node - ProseMirror node
 * @param {Function} props.updateAttributes - Function to update node attributes
 * @param {Editor} props.editor - Parent TipTap editor instance
 * @param {Function} props.getPos - Function to get node position
 */
const DetailsView = (props) => {
  const { node, updateAttributes, editor, getPos } = props
  const open = !!node.attrs.open

  // ============================================================================
  // State Management
  // ============================================================================

  const [taskId, setTaskId] = useState(null)
  const [saving, setSaving] = useState(false)
  const convertingImagesRef = useRef(false)
  const pendingImagesRef = useRef(new Set())

  // Initialize task ID from parent list item
  useEffect(() => { setTaskId(nearestListItemId(editor, getPos)) }, [])

  // Initialize nested editor for details content
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

  // ============================================================================
  // Image Upload Management
  // ============================================================================

  /**
   * Ensures all pasted data URI images are uploaded to server
   * Converts base64 images to permanent URLs and updates node attributes
   */
  const ensureUploadedImages = useCallback(async () => {
    if (!detailsEditor || convertingImagesRef.current) return
    convertingImagesRef.current = true
    try {
      // Collect all data URI images that need uploading
      const queue = []
      detailsEditor.state.doc.descendants((node, pos) => {
        if (node.type?.name !== 'image') return
        const src = node.attrs?.src
        if (!src || !isDataUri(src) || pendingImagesRef.current.has(src)) return
        queue.push({ pos, src })
        pendingImagesRef.current.add(src)
      })
      // Upload each image and update node attributes
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

  // ============================================================================
  // Effects
  // ============================================================================

  // Auto-upload images when editor updates
  useEffect(() => {
    if (!detailsEditor) return
    const handler = () => { ensureUploadedImages() }
    detailsEditor.on('update', handler)
    ensureUploadedImages()
    return () => { detailsEditor.off('update', handler) }
  }, [detailsEditor, ensureUploadedImages])

  // Load content when details panel opens
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

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <NodeViewWrapper className="details-block">
      {/* Toggle button for collapsing/expanding details */}
      <button className="details-pill" onClick={() => updateAttributes({ open: !open })}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && (
        <div className="details-panel">
          {/* Save status indicator */}
          <div className="save-indicator" style={{ marginBottom: 6 }}>{saving ? 'Saving…' : 'Auto-saved'}</div>
          {/* Nested editor for details content */}
          <EditorContent editor={detailsEditor} className="tiptap" />
          {/* Toolbar buttons for inserting content */}
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

// ============================================================================
// TipTap Extension Definition
// ============================================================================

/**
 * DetailsBlock TipTap Extension
 * Creates a collapsible details block node with nested rich text editor
 * Features:
 * - Collapsible/expandable state
 * - Independent nested editor for details content
 * - Auto-save functionality
 * - Image upload support
 * - Code block insertion
 */
export const DetailsBlock = Node.create({
  name: 'detailsBlock',
  group: 'block',
  content: '',
  selectable: false,
  atom: true,
  addAttributes() {
    return {
      open: { default: false }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-details-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-details-block': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DetailsView)
  }
})
