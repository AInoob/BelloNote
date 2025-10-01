import { uploadImage } from '../../api.js'
import { dataUriToFilePayload, isDataUri } from '../../utils/dataUri.js'

/**
 * Ensure all data URI images in the editor are uploaded to the server
 * @param {Object} editor - TipTap editor instance
 * @param {boolean} isReadOnly - Whether the editor is read-only
 * @param {Object} convertingImagesRef - Ref to track if conversion is in progress
 * @param {Object} pendingImageSrcRef - Ref to track pending image sources
 * @param {Function} normalizeImageSrc - Function to normalize image src
 */
export async function ensureUploadedImages(editor, isReadOnly, convertingImagesRef, pendingImageSrcRef, normalizeImageSrc) {
  if (!editor || isReadOnly || convertingImagesRef.current) return
  convertingImagesRef.current = true
  try {
    const queue = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type?.name !== 'image') return
      const src = node.attrs?.src
      if (!src || !isDataUri(src) || pendingImageSrcRef.current.has(src)) return
      queue.push({ pos, src })
      pendingImageSrcRef.current.add(src)
    })
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
}

