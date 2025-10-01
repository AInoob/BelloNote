// ============================================================================
// Image Handling Hook
// React hook for handling image uploads and normalization in the outline editor
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { absoluteUrl, uploadImage } from '../../api.js'
import { dataUriToFilePayload, isDataUri } from '../../utils/dataUri.js'

/**
 * Custom hook for handling image uploads and URL normalization
 * Automatically converts pasted data URI images to permanent server URLs
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {boolean} params.isReadOnly - Whether the editor is read-only
 * @returns {Object} Image handling utilities
 */
export function useImageHandling({ editor, isReadOnly }) {
  const convertingImagesRef = useRef(false) // Flag for image upload in progress
  const pendingImageSrcRef = useRef(new Set()) // Track data URIs being uploaded

  /**
   * Normalizes image src to absolute URL
   * @param {string} src - Image source (relative or absolute)
   * @returns {string} Absolute URL
   */
  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  /**
   * Finds and uploads pasted data URI images to the server
   * Replaces data URIs with permanent URLs after successful upload
   * Runs automatically after editor updates when in editable mode
   */
  const ensureUploadedImages = useCallback(async () => {
    if (!editor || isReadOnly || convertingImagesRef.current) return
    convertingImagesRef.current = true

    try {
      const queue = []

      // Find all data URI images in the document
      editor.state.doc.descendants((node, pos) => {
        if (node.type?.name !== 'image') return
        const src = node.attrs?.src
        if (!src || !isDataUri(src) || pendingImageSrcRef.current.has(src)) return
        queue.push({ pos, src })
        pendingImageSrcRef.current.add(src)
      })

      // Upload each data URI and replace with permanent URL
      for (const item of queue) {
        const payload = dataUriToFilePayload(item.src)
        if (!payload) {
          pendingImageSrcRef.current.delete(item.src)
          continue
        }

        try {
          const result = await uploadImage(payload.file, payload.name)
          const { state, view } = editor
          const node = state.doc.nodeAt(item.pos)
          if (!node || node.type?.name !== 'image') continue

          // Update image node with permanent URL and metadata
          const attrs = { ...node.attrs }
          attrs.src = normalizeImageSrc(result.url)
          if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
          if (result?.id) attrs['data-file-id'] = result.id
          view.dispatch(state.tr.setNodeMarkup(item.pos, undefined, attrs))
        } catch (err) {
          console.error('[outline] failed to upload pasted image', err)
        } finally {
          pendingImageSrcRef.current.delete(item.src)
        }
      }
    } finally {
      convertingImagesRef.current = false
    }
  }, [editor, isReadOnly, normalizeImageSrc])

  // Automatically upload data URI images after editor updates
  useEffect(() => {
    if (!editor || isReadOnly) return
    const handler = () => { ensureUploadedImages() }
    editor.on('update', handler)
    ensureUploadedImages() // Run on mount
    return () => {
      editor.off('update', handler)
    }
  }, [editor, isReadOnly, ensureUploadedImages])

  return {
    normalizeImageSrc,
    ensureUploadedImages
  }
}
