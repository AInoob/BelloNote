import { saveOutlineApi } from '../../api.js'
import { migrateCollapsedSets } from './collapsedSetMigration.js'

/**
 * Perform save operation for the outline
 * @param {Object} params - Save parameters
 * @param {Object} params.editor - TipTap editor instance
 * @param {boolean} params.isReadOnly - Whether the editor is read-only
 * @param {Object} params.savingRef - Ref to saving state
 * @param {Function} params.setSaving - State setter for saving
 * @param {Object} params.dirtyRef - Ref to dirty state
 * @param {Function} params.setDirty - State setter for dirty
 * @param {Function} params.parseOutline - Function to parse outline from editor
 * @param {Function} params.emitOutlineSnapshot - Function to emit outline snapshot
 * @param {Function} params.pushDebug - Debug logging function
 * @param {Object} params.focusRootRef - Ref to focus root ID
 * @param {Object} params.suppressUrlSyncRef - Ref to suppress URL sync
 * @param {Function} params.setFocusRootId - State setter for focus root ID
 * @param {Function} params.queueSave - Function to queue another save
 */
export async function doSave({
  editor,
  isReadOnly,
  savingRef,
  setSaving,
  dirtyRef,
  setDirty,
  parseOutline,
  emitOutlineSnapshot,
  pushDebug,
  focusRootRef,
  suppressUrlSyncRef,
  setFocusRootId,
  queueSave
}) {
  if (!editor || isReadOnly) return
  if (savingRef.current) return
  pushDebug('save: begin')
  savingRef.current = true
  setSaving(true)
  try {
    dirtyRef.current = false
    const { doc } = editor.state
    let tr = editor.state.tr, changed = false
    const seenIds = new Set()
    doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return
      const currentId = node.attrs.dataId
      if (!currentId || seenIds.has(currentId)) {
        const tmp = 'new-' + Math.random().toString(36).slice(2,8)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: tmp });
        seenIds.add(tmp)
        changed = true
      } else {
        seenIds.add(currentId)
      }
    })
    if (changed) { tr.setMeta('addToHistory', false); editor.view.dispatch(tr) }
    const outline = parseOutline()
    emitOutlineSnapshot(outline)
    pushDebug('save: parsed outline', { count: outline.length, titles: outline.map(n => n.title) })
    const data = await saveOutlineApi(outline)
    pushDebug('save: server reply', data)
    const mapping = data?.newIdMap || {}
    if (Object.keys(mapping).length) {
      pushDebug('save: applying id mapping', mapping)
      const { doc } = editor.state
      let tr2 = editor.state.tr, changed2 = false
      doc.descendants((node, pos) => {
        if (node.type.name === 'listItem') {
          const id = node.attrs.dataId
          if (mapping[id]) { tr2.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: String(mapping[id]) }); changed2 = true }
        }
      })
      if (changed2) { tr2.setMeta('addToHistory', false); editor.view.dispatch(tr2) }
      migrateCollapsedSets(mapping)
      if (focusRootRef.current && mapping[focusRootRef.current]) {
        const nextId = String(mapping[focusRootRef.current])
        suppressUrlSyncRef.current = true
        setFocusRootId(nextId)
        if (typeof window !== 'undefined') {
          try {
            const url = new URL(window.location.href)
            url.searchParams.set('focus', nextId)
            window.history.replaceState({ focus: nextId }, '', url)
          } catch {}
        }
      }
    }
    // Skip immediate refresh to avoid resetting the caret while editing
    if (!dirtyRef.current) setDirty(false)
    pushDebug('save: complete')
  } catch (e) {
    console.error('[save] failed:', e)
    pushDebug('save: error', { message: e.message, stack: e.stack })
  } finally {
    savingRef.current = false
    setSaving(false)
    if (dirtyRef.current) {
      pushDebug('save: rerun pending dirty state')
      queueSave(300)
    }
  }
}

