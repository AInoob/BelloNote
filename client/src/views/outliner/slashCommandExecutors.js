// ============================================================================
// Slash Command Executors
// Individual command implementations for the slash menu
// ============================================================================

import dayjs from 'dayjs'
import { TextSelection } from 'prosemirror-state'
import { uploadImage, absoluteUrl } from '../../api.js'

/**
 * Normalizes image source to absolute URL
 * @param {string} src - Image source
 * @returns {string} Absolute URL
 */
export const normalizeImageSrc = (src) => absoluteUrl(src)

/**
 * Inserts a block node (codeBlock, details, etc.) in a list-aware way
 * Handles special positioning for list items vs standalone paragraphs
 * @param {Editor} editor - TipTap editor instance
 * @param {Function} pushDebug - Debug logging function
 * @param {string} nodeName - Name of node type to insert
 * @param {Object} [attrs={}] - Node attributes
 * @param {Object} [options={}] - Insert options
 * @returns {boolean} True if insertion succeeded
 */
export function insertBlockNodeInList(editor, pushDebug, nodeName, attrs = {}, options = {}) {
  if (!editor) return false
  const { select = 'after' } = options
  return editor.chain().focus().command(({ state, dispatch, tr, commands }) => {
    const type = state.schema.nodes[nodeName]
    if (!type) return false
    const { $from } = state.selection

    let listItemDepth = -1
    for (let depth = $from.depth; depth >= 0; depth--) {
      if ($from.node(depth).type.name === 'listItem') {
        listItemDepth = depth
        break
      }
    }

    if (listItemDepth === -1) {
      return commands.insertContent({ type: nodeName, attrs })
    }

    let contentNode = null
    const defaultType = type.contentMatch?.defaultType
    if (defaultType) {
      if (defaultType.isText) {
        contentNode = state.schema.text('')
      } else {
        contentNode = defaultType.create()
      }
    }

    const newNode = type.create(attrs, contentNode ? [contentNode] : undefined)

    let blockDepth = -1
    for (let depth = $from.depth; depth > listItemDepth; depth--) {
      const current = $from.node(depth)
      if (current.isBlock) {
        blockDepth = depth
        break
      }
    }

    const insertPos = blockDepth >= 0
      ? $from.after(blockDepth)
      : $from.end(listItemDepth)

    tr.insert(insertPos, newNode)

    if (!dispatch) return true

    const targetPos = select === 'inside'
      ? insertPos + 1
      : insertPos + newNode.nodeSize

    try {
      tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos), 1))
    } catch (err) {
      try {
        tr.setSelection(TextSelection.create(tr.doc, targetPos))
      } catch {
        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size), -1))
      }
    }

    dispatch(tr.scrollIntoView())
    pushDebug('insert block node', {
      nodeName,
      insertPos,
      select,
      listItemDepth,
      blockDepth,
      from: $from.pos
    })
    return true
  }).run()
}

/**
 * Creates command executor factories with access to editor and utilities
 * @param {Object} params - Parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {Function} params.consumeSlashMarker - Function to consume slash marker
 * @param {Function} params.cleanDanglingSlash - Function to clean dangling slash
 * @param {Function} params.closeSlash - Function to close slash menu
 * @param {Function} params.pushDebug - Debug logging function
 * @param {Function} params.setDatePickerOpen - Function to open date picker
 * @param {Object} params.datePickerValueRef - Ref for date picker value
 * @param {Object} params.datePickerCaretRef - Ref for date picker caret position
 * @returns {Object} Object containing all command executors
 */
export function createCommandExecutors({
  editor,
  consumeSlashMarker,
  cleanDanglingSlash,
  closeSlash,
  pushDebug,
  setDatePickerOpen,
  datePickerValueRef,
  datePickerCaretRef
}) {
  /** Inserts today's date (@YYYY-MM-DD) at cursor */
  const insertToday = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + dayjs().format('YYYY-MM-DD')).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert date today')
  }

  /** Opens date picker for custom date selection */
  const insertPick = () => {
    const today = dayjs().format('YYYY-MM-DD')
    datePickerValueRef.current = today
    const selFrom = editor?.state?.selection?.from ?? null
    datePickerCaretRef.current = selFrom

    setDatePickerOpen(true)
    closeSlash({ preserveMarker: true })
  }

  /**
   * Inserts a generic tag at cursor
   * @param {string} tag - Tag name (without @)
   */
  const insertTagged = (tag) => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(` @${tag}`).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug(`insert ${tag} tag`)
  }

  // Quick tag insertion helpers
  const insertArchived = () => insertTagged('archived')
  const insertFuture = () => insertTagged('future')
  const insertSoon = () => insertTagged('soon')

  /**
   * Inserts a hashtag from slash command query
   * @param {Object} tagInfo - Parsed tag information
   */
  const insertTagFromSlash = (tagInfo) => {
    if (!tagInfo) return
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    let insertion = `#${tagInfo.display}`
    try {
      const { doc } = editor?.state || {}
      const pos = caretPos ?? 0
      if (doc && pos > 0) {
        const prevChar = doc.textBetween(pos - 1, pos, '\n', '\n') || ''
        if (prevChar && !/\s/.test(prevChar)) insertion = ' ' + insertion
      }
    } catch {}
    editor?.chain().focus().insertContent(insertion).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert tag', { tag: tagInfo.canonical })
  }

  const insertCode = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    const inserted = insertBlockNodeInList(editor, pushDebug, 'codeBlock', {}, { select: 'inside' })
    if (inserted) {
      pushDebug('doc after code insert', { doc: editor.getJSON() })
    } else {
      pushDebug('insert code block fallback')
      editor.chain().focus().insertContent({ type: 'codeBlock' }).run()
    }
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert code block')
  }

  const applyPickedDate = () => {
    const value = datePickerValueRef.current
    setDatePickerOpen(false)
    if (!value) return
    const caretPos = datePickerCaretRef.current ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + value).run()
    if (datePickerCaretRef.slashMarkerPos != null) cleanDanglingSlash(datePickerCaretRef.slashMarkerPos)
    pushDebug('insert date picked', { value })
  }

  const insertImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    closeSlash({ preserveMarker: true })
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const removed = consumeSlashMarker()
      const result = await uploadImage(file)
      const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
      if (caretPos !== null) {
        editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
      }
      const normalized = normalizeImageSrc(result.url)
      const attrs = { src: normalized }
      if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
      if (result?.id) attrs['data-file-id'] = result.id
      editor?.chain().focus().setImage(attrs).run()
      if (removed) cleanDanglingSlash(removed.from)
      pushDebug('insert image', { url: normalized, id: result?.id })
      closeSlash()
    }
    input.click()
  }

  const insertDetails = () => {
    const removed = consumeSlashMarker()
    const inserted = insertBlockNodeInList(editor, pushDebug, 'detailsBlock')
    if (!inserted) editor?.chain().focus().insertContent({ type: 'detailsBlock' }).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert details block')
  }

  return {
    insertToday,
    insertPick,
    insertTagged,
    insertArchived,
    insertFuture,
    insertSoon,
    insertTagFromSlash,
    insertCode,
    applyPickedDate,
    insertImage,
    insertDetails
  }
}
