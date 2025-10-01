import { useCallback, useEffect, useRef, useState } from 'react'
import {
  COLLAPSED_CACHE,
  collapsedStorageKey
} from './collapsedState.js'
import { COLLAPSED_KEY } from './constants.js'
import { saveOutlineApi } from '../../api.js'
import { parseOutlineFromEditor } from './outlineSerialization.js'

function migrateCollapsedSets(idMapping) {
  if (!idMapping || typeof idMapping !== 'object') return
  const entries = Object.entries(idMapping)
  if (!entries.length) return
  const normalize = (value) => String(value ?? '')
  const replaceInArray = (arr) => arr.map((value) => {
    const mapped = idMapping[normalize(value)]
    return mapped !== undefined ? normalize(mapped) : normalize(value)
  })
  const writeCacheAndStorage = (key, arrValues) => {
    const normalized = arrValues.map(normalize)
    COLLAPSED_CACHE.set(key, normalized)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, JSON.stringify(normalized))
      } catch {}
    }
  }

  entries.forEach(([oldIdRaw, newIdRaw]) => {
    const oldId = normalize(oldIdRaw)
    const newId = normalize(newIdRaw)
    const oldKey = collapsedStorageKey(oldId)
    const newKey = collapsedStorageKey(newId)
    if (COLLAPSED_CACHE.has(oldKey)) {
      const cached = COLLAPSED_CACHE.get(oldKey) || []
      writeCacheAndStorage(newKey, replaceInArray(cached))
      COLLAPSED_CACHE.delete(oldKey)
    }
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(oldKey)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          const arr = Array.isArray(parsed) ? replaceInArray(parsed) : []
          window.localStorage.setItem(newKey, JSON.stringify(arr))
        }
        window.localStorage.removeItem(oldKey)
      } catch {}
    }
  })

  const cacheKeys = Array.from(COLLAPSED_CACHE.keys())
  cacheKeys.forEach((key) => {
    const current = COLLAPSED_CACHE.get(key) || []
    const updated = replaceInArray(current)
    let changed = updated.length !== current.length
    if (!changed) {
      for (let i = 0; i < updated.length; i += 1) {
        if (updated[i] !== current[i]) { changed = true; break }
      }
    }
    if (changed) writeCacheAndStorage(key, updated)
  })

  if (typeof window === 'undefined') return
  const keysToReview = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (key && key.startsWith(COLLAPSED_KEY)) keysToReview.push(key)
  }
  keysToReview.forEach((key) => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const updated = replaceInArray(parsed)
      let changed = updated.length !== parsed.length
      if (!changed) {
        for (let i = 0; i < updated.length; i += 1) {
          if (updated[i] !== parsed[i]) { changed = true; break }
        }
      }
      if (changed) window.localStorage.setItem(key, JSON.stringify(updated))
    } catch {}
  })
}

export function useOutlineSaving({
  editor,
  isReadOnly,
  normalizeImageSrc,
  emitOutlineSnapshot,
  focusRootRef,
  focusRootSetterRef,
  suppressUrlSyncRef,
  pushDebug
}) {
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const saveTimerRef = useRef(null)
  const doSaveRefInternal = useRef(null)

  const markDirty = useCallback(() => {
    if (isReadOnly) return
    dirtyRef.current = true
    setDirty(true)
  }, [isReadOnly])

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const doSave = useCallback(async function runSave() {
    if (!editor || isReadOnly) return
    if (savingRef.current) return
    pushDebug?.('save: begin')
    savingRef.current = true
    setSaving(true)
    try {
      dirtyRef.current = false
      const { doc } = editor.state
      let tr = editor.state.tr
      let mutated = false
      const seenIds = new Set()
      doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem') return
        const currentId = node.attrs.dataId
        if (!currentId || seenIds.has(currentId)) {
          const tmp = `new-${Math.random().toString(36).slice(2, 8)}`
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: tmp })
          seenIds.add(tmp)
          mutated = true
        } else {
          seenIds.add(currentId)
        }
      })
      if (mutated) {
        tr.setMeta('addToHistory', false)
        editor.view.dispatch(tr)
      }

      const outline = editor
        ? parseOutlineFromEditor(editor, normalizeImageSrc, pushDebug || (() => {}))
        : []
      emitOutlineSnapshot?.(outline)
      pushDebug?.('save: parsed outline', { count: outline.length })
      const data = await saveOutlineApi(outline)
      pushDebug?.('save: server reply', data)

      const mapping = data?.newIdMap || {}
      if (Object.keys(mapping).length) {
        pushDebug?.('save: applying id mapping', mapping)
        let tr2 = editor.state.tr
        let changed2 = false
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'listItem') {
            const id = node.attrs.dataId
            if (id && mapping[id]) {
              tr2 = tr2.setNodeMarkup(pos, undefined, { ...node.attrs, dataId: String(mapping[id]) })
              changed2 = true
            }
          }
        })
        if (changed2) {
          tr2.setMeta('addToHistory', false)
          editor.view.dispatch(tr2)
        }
        migrateCollapsedSets(mapping)
        if (focusRootRef?.current && mapping[focusRootRef.current]) {
          const nextId = String(mapping[focusRootRef.current])
          suppressUrlSyncRef.current = true
          const setter = focusRootSetterRef?.current
          if (setter) setter(nextId)
          if (typeof window !== 'undefined') {
            try {
              const url = new URL(window.location.href)
              url.searchParams.set('focus', nextId)
              window.history.replaceState({ focus: nextId }, '', url)
            } catch {}
          }
        }
      }

      if (!dirtyRef.current) setDirty(false)
      pushDebug?.('save: complete')
    } catch (error) {
      console.error('[save] failed:', error)
      pushDebug?.('save: error', { message: error.message, stack: error.stack })
    } finally {
      savingRef.current = false
      setSaving(false)
      if (dirtyRef.current && !isReadOnly) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          const next = doSaveRefInternal.current
          if (next) void next()
        }, 300)
      }
    }
  }, [editor, isReadOnly, normalizeImageSrc, emitOutlineSnapshot, focusRootRef, focusRootSetterRef, suppressUrlSyncRef, pushDebug])

  const queueSave = useCallback((delay = 700) => {
    if (isReadOnly) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const next = doSaveRefInternal.current
      if (next) void next()
    }, delay)
  }, [isReadOnly, doSave])

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    doSaveRefInternal.current = doSave
    return () => {
      if (doSaveRefInternal.current === doSave) {
        doSaveRefInternal.current = null
      }
    }
  }, [doSave])

  return {
    dirty,
    saving,
    markDirty,
    queueSave,
    cancelPendingSave,
    doSave
  }
}
