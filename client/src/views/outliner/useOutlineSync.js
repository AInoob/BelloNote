// ============================================================================
// Outline Sync Hook
// React hook for managing outline save/load and dirty state tracking
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { getOutline, saveOutlineApi } from '../../api.js'

/**
 * Custom hook for managing outline persistence and synchronization
 * Handles auto-save, dirty state tracking, and ID mapping after save
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {boolean} params.isReadOnly - Whether the editor is read-only
 * @param {Function} params.parseOutline - Function to parse editor content to outline
 * @param {Function} params.emitOutlineSnapshot - Function to broadcast outline changes
 * @param {Function} params.pushDebug - Debug logging function
 * @param {Function} params.migrateCollapsedSets - Function to migrate collapsed state IDs
 * @param {Function} params.onFocusRootIdMapped - Callback when focus root ID is remapped
 * @returns {Object} Sync utilities and state
 */
export function useOutlineSync({
  editor,
  isReadOnly,
  parseOutline,
  emitOutlineSnapshot,
  pushDebug,
  migrateCollapsedSets,
  onFocusRootIdMapped
}) {
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const saveTimer = useRef(null)

  /**
   * Marks the outline as dirty (unsaved changes)
   */
  const markDirty = useCallback(() => {
    if (isReadOnly) return
    dirtyRef.current = true
    setDirty(true)
  }, [isReadOnly])

  /**
   * Queues a save operation with debouncing
   * @param {number} delay - Delay in ms before save (default 700ms)
   */
  const queueSave = useCallback((delay = 700) => {
    if (isReadOnly) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(), delay)
  }, [isReadOnly])

  /**
   * Performs the actual save operation
   * Assigns temporary IDs, parses outline, saves to API, and remaps IDs
   */
  const doSave = useCallback(async () => {
    if (!editor || isReadOnly) return
    if (savingRef.current) return

    pushDebug('save: begin')
    savingRef.current = true
    setSaving(true)

    try {
      dirtyRef.current = false
      const { doc } = editor.state
      let tr = editor.state.tr
      let changed = false
      const seenIds = new Set()

      // Assign temporary IDs to any nodes without IDs or with duplicate IDs
      doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem') return
        const currentId = node.attrs.dataId
        if (!currentId || seenIds.has(currentId)) {
          const tmp = 'new-' + Math.random().toString(36).slice(2, 8)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: tmp })
          seenIds.add(tmp)
          changed = true
        } else {
          seenIds.add(currentId)
        }
      })

      if (changed) {
        tr.setMeta('addToHistory', false)
        editor.view.dispatch(tr)
      }

      // Parse and save outline
      const outline = parseOutline()
      emitOutlineSnapshot(outline)
      pushDebug('save: parsed outline', { count: outline.length, titles: outline.map(n => n.title) })

      const data = await saveOutlineApi(outline)
      pushDebug('save: server reply', data)

      // Apply ID mapping from server (temp IDs -> permanent IDs)
      const mapping = data?.newIdMap || {}
      if (Object.keys(mapping).length) {
        pushDebug('save: applying id mapping', mapping)
        const { doc } = editor.state
        let tr2 = editor.state.tr
        let changed2 = false

        doc.descendants((node, pos) => {
          if (node.type.name === 'listItem') {
            const id = node.attrs.dataId
            if (mapping[id]) {
              tr2.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: String(mapping[id]) })
              changed2 = true
            }
          }
        })

        if (changed2) {
          tr2.setMeta('addToHistory', false)
          editor.view.dispatch(tr2)
        }

        // Migrate collapsed state and focus ID
        migrateCollapsedSets(mapping)
        onFocusRootIdMapped?.(mapping)
      }

      // Only clear dirty if no new changes occurred during save
      if (!dirtyRef.current) setDirty(false)
      pushDebug('save: complete')
    } catch (e) {
      console.error('[save] failed:', e)
      pushDebug('save: error', { message: e.message, stack: e.stack })
    } finally {
      savingRef.current = false
      setSaving(false)

      // If dirty again, queue another save
      if (dirtyRef.current) {
        pushDebug('save: rerun pending dirty state')
        queueSave(300)
      }
    }
  }, [editor, isReadOnly, parseOutline, emitOutlineSnapshot, pushDebug, migrateCollapsedSets, onFocusRootIdMapped, queueSave])

  /**
   * Loads the outline from the server
   * @param {Function} buildList - Function to build ProseMirror doc from outline
   * @param {Function} applyCollapsedState - Function to apply collapsed state
   * @param {Function} scheduleFilter - Function to schedule filter application
   */
  const loadOutline = useCallback(async (buildList, applyCollapsedState, scheduleFilter) => {
    if (!editor || isReadOnly) return

    const data = await getOutline()
    const roots = data.roots || []
    const doc = buildList(roots)

    editor.commands.setContent(doc)
    dirtyRef.current = false
    setDirty(false)
    pushDebug('loaded outline', { roots: roots.length })

    applyCollapsedState()
    scheduleFilter('initial-outline-load')
  }, [editor, isReadOnly, pushDebug])

  // Listen for manual save requests
  useEffect(() => {
    if (isReadOnly) return
    const handler = () => queueSave(0)
    window.addEventListener('worklog:request-save', handler)
    return () => window.removeEventListener('worklog:request-save', handler)
  }, [isReadOnly, queueSave])

  return {
    dirty,
    saving,
    markDirty,
    queueSave,
    doSave,
    loadOutline
  }
}
