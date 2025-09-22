
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ImageWithMeta } from '../extensions/imageWithMeta.js'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import ListItem from '@tiptap/extension-list-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import { lowlight } from 'lowlight/lib/core.js'
import dayjs from 'dayjs'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { API_ROOT, absoluteUrl, getOutline, saveOutlineApi, uploadImage } from '../api.js'
import { dataUriToFilePayload, isDataUri } from '../utils/dataUri.js'
import { WorkDateHighlighter } from '../extensions/workDateHighlighter'
import { DetailsBlock } from '../extensions/detailsBlock.jsx'

const STATUS_ORDER = ['todo','in-progress','done']
const STATUS_ICON = { 'todo': '○', 'in-progress': '◐', 'done': '✓' }
const DATE_RE = /@\d{4}-\d{2}-\d{2}/g
const COLLAPSED_KEY = 'worklog.collapsed'
const LOG_ON = () => (localStorage.getItem('WL_DEBUG') === '1')
const LOG = (...args) => { if (LOG_ON()) console.log('[slash]', ...args) }

const loadCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')) } catch { return new Set() } }
const saveCollapsed = (s) => localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(s)))

const URL_PROTOCOL_RE = /^[a-z][\w+.-]*:\/\//i
const DOMAIN_LIKE_RE = /^[\w.-]+\.[a-z]{2,}(?:\/[\w#?=&%+@.\-]*)?$/i

const isLikelyUrl = (value = '') => {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (URL_PROTOCOL_RE.test(trimmed)) {
    try { new URL(trimmed); return true } catch { return false }
  }
  return DOMAIN_LIKE_RE.test(trimmed)
}

const normalizeUrl = (value = '') => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (URL_PROTOCOL_RE.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const escapeForRegex = (value = '') => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

function CodeBlockView(props) {
  const { node, extension, updateAttributes, editor } = props
  const [copied, setCopied] = useState(false)
  const codeText = useMemo(() => node.textContent || '', [node])
  const languageLabel = useMemo(() => {
    const raw = node.attrs.language
    if (!raw || typeof raw !== 'string') return 'Code'
    if (!raw.trim()) return 'Code'
    return raw
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(part => part[0]?.toUpperCase() + part.slice(1))
      .join(' ')
  }, [node.attrs.language])

  const handleCopy = async () => {
    const text = codeText.replace(/\u200b/g, '')
    const reset = () => setCopied(false)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(reset, 1500)
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(reset, 1500)
      } catch {
        setCopied(false)
      }
    }
  }

  return (
    <NodeViewWrapper className="code-block-wrapper" data-language={node.attrs.language || ''}>
      <div className="code-block-actions" contentEditable={false} tabIndex={-1}>
        <span className="code-block-label">{languageLabel}</span>
        <button
          type="button"
          className={`code-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          tabIndex={-1}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>
          <NodeViewContent as="span" />
        </code>
      </pre>
    </NodeViewWrapper>
  )
}

function createTaskListItemExtension({ readOnly, draggingState, allowStatusToggleInReadOnly, onStatusToggle }) {
  return ListItem.extend({
    name: 'listItem',
    draggable: !readOnly,
    selectable: true,
    addAttributes() {
      return {
        dataId: { default: null },
        status: { default: 'todo' },
        collapsed: { default: false },
        archivedSelf: { default: false }
      }
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <ListItemView
          {...props}
          readOnly={readOnly}
          draggingState={draggingState}
          allowStatusToggleInReadOnly={allowStatusToggleInReadOnly}
          onStatusToggle={onStatusToggle}
        />
      ))
    }
  })
}

function ListItemView(props) {
  const { node, updateAttributes, editor, getPos, readOnly = false, draggingState, allowStatusToggleInReadOnly = false, onStatusToggle = null } = props
  const id = node.attrs.dataId
  const status = node.attrs.status || 'todo'
  const collapsed = !!node.attrs.collapsed
  const fallbackIdRef = useRef(id ? String(id) : `temp-${Math.random().toString(36).slice(2, 8)}`)
  const justDraggedRef = useRef(false)
  const draggingRef = draggingState || { current: null }

  useEffect(() => {
    if (id) fallbackIdRef.current = String(id)
  }, [id])

  useEffect(() => {
    const set = loadCollapsed()
    if (id && set.has(String(id)) !== collapsed) updateAttributes({ collapsed: set.has(String(id)) })
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    updateAttributes({ collapsed: next })
    const set = loadCollapsed()
    if (id) { next ? set.add(String(id)) : set.delete(String(id)); saveCollapsed(set) }
  }

  const cycle = () => {
    if (readOnly && !allowStatusToggleInReadOnly) return
    const idx = STATUS_ORDER.indexOf(status)
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
    updateAttributes({ status: next })
    if (readOnly && allowStatusToggleInReadOnly && typeof onStatusToggle === 'function') {
      const realId = id || fallbackIdRef.current
      if (realId) onStatusToggle(String(realId), next)
    }
  }

  const handleDragStart = (event) => {
    if (readOnly) return
    try {
      justDraggedRef.current = true
      let currentId = id ? String(id) : fallbackIdRef.current
      if (!currentId) {
        currentId = 'new-' + Math.random().toString(36).slice(2, 8)
        updateAttributes({ dataId: currentId })
      }
      fallbackIdRef.current = currentId
      const pos = getPos()
      const view = editor.view
      const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
      view.dispatch(tr)
      console.log('[drag] start', { id: currentId, pos })
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', ' ')
        event.dataTransfer.effectAllowed = 'move'
      }
      view.dragging = { slice: view.state.selection.content(), move: true }
      if (event.currentTarget instanceof HTMLElement) {
        const wrapper = event.currentTarget.closest('li.li-node')
        if (wrapper) wrapper.setAttribute('data-id', currentId)
      }
      if (draggingRef) {
        draggingRef.current = {
          id: currentId,
          element: event.currentTarget instanceof HTMLElement
            ? event.currentTarget.closest('li.li-node')
            : null
        }
      }
    } catch (e) {
      console.error('[drag] failed to select node', e)
    }
  }

  const handleDragEnd = () => {
    if (readOnly) return
    const last = draggingRef?.current
    if (last) console.log('[drag] end', { id: last.id })
    if (draggingRef) draggingRef.current = null
    if (editor?.view) editor.view.dragging = null
    // Defer resetting until after click events complete so we can detect drag+click
    setTimeout(() => { justDraggedRef.current = false }, 0)
  }

  const handleToggleClick = () => {
    if (justDraggedRef.current) {
      // Skip toggling when the control was just used for dragging
      justDraggedRef.current = false
      return
    }
    toggleCollapse()
  }

  return (
    <NodeViewWrapper
      as="li"
      className={`li-node ${collapsed ? 'collapsed' : ''}`}
      data-status={status}
      data-id={id ? String(id) : fallbackIdRef.current}
      data-archived-self={node.attrs.archivedSelf ? '1' : '0'}
      data-archived={node.attrs.archivedSelf ? '1' : '0'}
      draggable={!readOnly}
      onDragEnd={readOnly ? undefined : handleDragEnd}
    >
      <div className="li-row">
        <button
          className="caret drag-toggle"
          onClick={handleToggleClick}
          title={collapsed ? 'Expand (drag to reorder)' : 'Collapse (drag to reorder)'}
          draggable={!readOnly}
          onDragStart={readOnly ? undefined : handleDragStart}
          type="button"
        >
          <span className="caret-arrow" aria-hidden>{collapsed ? '▸' : '▾'}</span>
          <span className="caret-grip" aria-hidden>⋮</span>
        </button>
        <button
          className="status-chip inline"
          onClick={(readOnly && !allowStatusToggleInReadOnly) ? undefined : cycle}
          title="Click to change status"
          disabled={readOnly && !allowStatusToggleInReadOnly}
        >
          {STATUS_ICON[status] || '○'}
        </button>
        <NodeViewContent className="li-content" />
      </div>
    </NodeViewWrapper>
  )
}

export default function OutlinerView({ onSaveStateChange = () => {}, showDebug=false, readOnly = false, initialOutline = null, forceExpand = false, allowStatusToggleInReadOnly = false, onStatusToggle = null }) {
  const isReadOnly = !!readOnly
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 })
  const [debugLines, setDebugLines] = useState([])
  const menuRef = useRef(null)
  const slashMarker = useRef(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [statusFilter, setStatusFilter] = useState({ todo: true, 'in-progress': true, done: true })
  const [showArchived, setShowArchived] = useState(true)
  const applyStatusFilterRef = useRef(null)
  const [slashQuery, setSlashQuery] = useState('')
  const slashQueryRef = useRef('')
  const slashInputRef = useRef(null)
  const slashSelectedRef = useRef(0)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const filteredCommandsRef = useRef([])
  const closeSlashRef = useRef(() => {})
  const draggingRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchQueryRef = useRef('')
  const convertingImagesRef = useRef(false)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerValueRef = useRef(dayjs().format('YYYY-MM-DD'))
  const datePickerCaretRef = useRef(null)

  const pendingImageSrcRef = useRef(new Set())

  const taskListItemExtension = useMemo(
    () => createTaskListItemExtension({ readOnly: isReadOnly, draggingState: draggingRef, allowStatusToggleInReadOnly, onStatusToggle }),
    [isReadOnly, draggingRef, allowStatusToggleInReadOnly, onStatusToggle]
  )

  const updateSlashActive = useCallback((idx) => {
    slashSelectedRef.current = idx
    setSlashActiveIndex(idx)
  }, [])

  useEffect(() => {
    return () => {
      draggingRef.current = null
    }
  }, [draggingRef])
  useEffect(() => { slashQueryRef.current = slashQuery }, [slashQuery])
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  const pushDebug = (msg, extra={}) => {
    const line = `${new Date().toLocaleTimeString()} ${msg} ${Object.keys(extra).length? JSON.stringify(extra): ''}`
    setDebugLines(s => [...s.slice(-200), line])
    LOG(msg, extra)
  }

  const CodeBlockWithCopy = useMemo(
    () => CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView)
      }
    }).configure({ lowlight }),
    []
  )

  const imageExtension = useMemo(
    () => ImageWithMeta.configure({ inline: true, allowBase64: true }),
    []
  )

  const extensions = useMemo(() => [
    StarterKit.configure({ listItem: false, codeBlock: false }),
    taskListItemExtension,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    Highlight.configure({ multicolor: true }),
    imageExtension,
    CodeBlockWithCopy,
    WorkDateHighlighter,
    DetailsBlock
  ], [taskListItemExtension, CodeBlockWithCopy, imageExtension])

  const editor = useEditor({
    // disable default codeBlock to avoid duplicate name with CodeBlockLowlight
    extensions,
    content: '<p>Loading…</p>',
    autofocus: !isReadOnly,
    editable: !isReadOnly,
    onCreate: () => { pushDebug('editor: ready'); setTimeout(() => applyStatusFilter(), 50) },
    onUpdate: () => { if (!isReadOnly) { markDirty(); queueSave() } setTimeout(() => applyStatusFilter(), 50) },
    editorProps: {
      handleTextInput(view, from, to, text) {
        if (isReadOnly) return false
        if (text === '/') {
          pushDebug('handleTextInput " / " passthrough', { from, to })
          return false
        }
        return false
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          if (isReadOnly) return false
          const e = event
          if (e && e.inputType === 'insertText' && e.data === '/') {
            pushDebug('beforeinput passthrough for " / "')
            return false
          }
          return false
        },
        keypress: (view, event) => {
          if (isReadOnly) return false
          if (event.key === '/') {
            pushDebug('keypress passthrough for " / "')
            return false
          }
          return false
        },
        input: (view, event) => {
          if (isReadOnly) return false
          const data = event.data || ''
          if (data === '/') {
            pushDebug('input passthrough for " / "')
            return false
          }
          return false
        }
      },
      handlePaste(view, event) {
        if (isReadOnly) return false
        // 1) Prefer our lossless clipboard format when available
        try {
          const jsonStr = event.clipboardData?.getData('application/x-worklog-outline+json')
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr)
            event.preventDefault()
            editor?.commands?.setContent(parsed)
            pushDebug('paste: outline json restored')
            return true
          }
        } catch {}
        // 2) Smart-link paste when the clipboard is a single URL and there is a selection
        const text = event.clipboardData?.getData('text/plain') || ''
        const trimmed = text.trim()
        if (!trimmed || !isLikelyUrl(trimmed)) return false
        if (view.state.selection.empty) return false
        event.preventDefault()
        const href = normalizeUrl(trimmed)
        editor?.chain().focus().setLink({ href }).run()
        pushDebug('paste: link applied', { href })
        return true
      },
      handleKeyDown(view, event) {
        if (isReadOnly) return false
        if (slashOpen) {
          if (event.key === 'Enter') {
            const command = filteredCommandsRef.current[slashSelectedRef.current] || filteredCommandsRef.current[0]
            if (command) {
              event.preventDefault()
              event.stopPropagation()
              command.run()
              return true
            }
          }
          if (event.key === 'ArrowDown') {
            if (filteredCommandsRef.current.length) {
              event.preventDefault()
              const next = (slashSelectedRef.current + 1) % filteredCommandsRef.current.length
              updateSlashActive(next)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            if (filteredCommandsRef.current.length) {
              event.preventDefault()
              const next = (slashSelectedRef.current - 1 + filteredCommandsRef.current.length) % filteredCommandsRef.current.length
              updateSlashActive(next)
            }
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeSlashRef.current()
            return true
          }
        }
        const isSlashKey = event.key === '/' || event.key === '?' || event.code === 'Slash'
        if (isSlashKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (inCode) { pushDebug('keydown "/" ignored in code block'); return false }
          event.preventDefault()
          event.stopPropagation()
          const char = event.shiftKey && event.key === '?' ? '?' : '/'
          const { from } = editor.state.selection
          slashMarker.current = { pos: from, char }
          editor.chain().focus().insertContent(char).run()
          let rect
          try {
            const after = editor.state.selection.from
            rect = view.coordsAtPos(after)
          } catch (e) {
            rect = { left: 0, bottom: 0 }
            pushDebug('popup: coords fail', { error: e.message })
          }
          updateSlashActive(0)
          setSlashPos({ x: rect.left, y: rect.bottom + 4 })
          setSlashOpen(true)
          setSlashQuery('')
          pushDebug('popup: open (keydown)', { key: event.key, char, left: rect.left, top: rect.bottom })
          return true
        }
        if (event.key === 'Enter') {
          // Ensure the newly created list item starts with status "todo"
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (inCode) return false
          event.preventDefault()
          event.stopPropagation()
          const didSplit = editor.chain().focus().splitListItem('listItem').run()
          if (didSplit) {
            // Update attributes on the newly created list item
            editor.chain().focus().updateAttributes('listItem', { status: 'todo', dataId: null, collapsed: false }).run()
            pushDebug('enter: split list item -> reset status to todo')
            return true
          }
          return false
        }
        if (event.key === 'Tab') {
          const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
          if (!inCode) {
            event.preventDefault()
            const cmd = event.shiftKey ? 'liftListItem' : 'sinkListItem'
            editor.chain().focus()[cmd]('listItem').run()
            pushDebug('indentation', { shift: event.shiftKey })
            return true
          }
          return false
        }
        if (event.key === 'ArrowRight') {
          const { $from } = view.state.selection
          const parent = $from.parent
          if (parent.type.name === 'codeBlock' && $from.parentOffset === parent.content.size) {
            event.preventDefault()
            const exited = editor.commands.exitCode()
            if (!exited) {
              editor.chain().focus().insertContent('\n').run()
              editor.commands.exitCode()
            }
            pushDebug('codeblock: exit via ArrowRight')
            return true
          }
        }
        if (event.key === 'ArrowDown') {
          if (moveIntoFirstChild(view)) { event.preventDefault(); pushDebug('moveIntoFirstChild'); return true }
        }
        if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          const { from } = editor.state.selection
          const rect = view.coordsAtPos(from)
          setSlashPos({ x: rect.left, y: rect.bottom + 4 })
          setSlashOpen(true)
          pushDebug('popup: open (Ctrl/Cmd+Space)')
          return true
        }
        return false
      }
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__WORKLOG_EDITOR = editor
    }
    return () => {
      if (typeof window !== 'undefined' && window.__WORKLOG_EDITOR === editor) {
        window.__WORKLOG_EDITOR = null
      }
    }
  }, [editor])

  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  const ensureUploadedImages = useCallback(async () => {
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
  }, [editor, isReadOnly, normalizeImageSrc])

  useEffect(() => {
    if (!editor || isReadOnly) return
    const handler = () => { ensureUploadedImages() }
    editor.on('update', handler)
    ensureUploadedImages()
    return () => {
      editor.off('update', handler)
    }
  }, [editor, isReadOnly, ensureUploadedImages])

  const applySearchHighlight = useCallback(() => {
    if (!editor) return
    const { state } = editor
    const { doc, selection } = state
    const highlightMark = editor.schema.marks.highlight
    if (!highlightMark) return
    let tr = state.tr.removeMark(0, doc.content.size, highlightMark)
    const query = searchQueryRef.current.trim()
    if (!query) {
      tr.setMeta('addToHistory', false)
      tr.setSelection(selection.map(tr.doc, tr.mapping))
      editor.view.dispatch(tr)
      return
    }
    let regex
    try {
      regex = new RegExp(escapeForRegex(query), 'gi')
    } catch {
      tr.setMeta('addToHistory', false)
      tr.setSelection(selection.map(tr.doc, tr.mapping))
      editor.view.dispatch(tr)
      return
    }
    doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text || ''
      let match
      while ((match = regex.exec(text)) !== null) {
        const from = pos + match.index
        const to = from + match[0].length
        tr = tr.addMark(from, to, highlightMark.create({ color: '#fde68a' }))
      }
    })
    tr.setMeta('addToHistory', false)
    tr.setSelection(selection.map(tr.doc, tr.mapping))
    editor.view.dispatch(tr)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const updateSlashState = () => {
      const marker = slashMarker.current
      if (!marker) {
        if (slashQueryRef.current) setSlashQuery('')
        return
      }
      try {
        const { pos } = marker
        const { from } = editor.state.selection
        const to = Math.max(from, pos + 1)
        const text = editor.state.doc.textBetween(pos, to, '\n', '\n')
        if (!text.startsWith('/')) {
          closeSlashRef.current()
          return
        }
        const query = text.slice(1)
        if (slashQueryRef.current !== query) setSlashQuery(query)
      } catch (err) {
        if (slashQueryRef.current) setSlashQuery('')
      }
    }
    editor.on('update', updateSlashState)
    editor.on('selectionUpdate', updateSlashState)
    return () => {
      editor.off('update', updateSlashState)
      editor.off('selectionUpdate', updateSlashState)
    }
  }, [editor])

  useEffect(() => {
    if (slashOpen) {
      updateSlashActive(0)
      requestAnimationFrame(() => {
        slashInputRef.current?.focus()
        slashInputRef.current?.select()
      })
    }
  }, [slashOpen])

  useEffect(() => {
    if (!editor) return
    applySearchHighlight()
  }, [editor, applySearchHighlight, searchQuery])

  useEffect(() => {
    if (!editor) return
    const handler = () => applySearchHighlight()
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor, applySearchHighlight])

  useEffect(() => { onSaveStateChange({ dirty, saving }) }, [dirty, saving])

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const img = target.closest('img')
      if (img && dom.contains(img)) {
        event.preventDefault()
        const src = absoluteUrl(img.getAttribute('src') || '')
        setImagePreview(src)
        pushDebug('image: preview open', { src })
      }
    }
    dom.addEventListener('click', handler)
    return () => dom.removeEventListener('click', handler)
  }, [editor, pushDebug])

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!slashOpen) return
      if (menuRef.current && !menuRef.current.contains(e.target)) { closeSlash(); pushDebug('popup: close by outside click') }
    }
    function onDocKeyDown(e) {
      if (!slashOpen) return
      const isNav = ['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)
      const insideMenu = menuRef.current && menuRef.current.contains(e.target)
      if (e.key === 'Escape') { closeSlash(); e.preventDefault(); pushDebug('popup: close by ESC') }
      else if (!insideMenu && !isNav && e.key.length === 1 && e.key !== '/' && e.key !== '?') {
        closeSlash();
        pushDebug('popup: close by typing', { key:e.key })
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [slashOpen])

  function moveIntoFirstChild(view) {
    const { state } = view
    const { $from } = state.selection
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'listItem') {
        const inPara = $from.parent.type.name === 'paragraph'
        const atEnd = $from.parentOffset === $from.parent.content.size
        const collapsed = node.attrs?.collapsed
        if (!inPara || !atEnd || collapsed) return false
        let childIndex = -1
        for (let i = 0; i < node.childCount; i++) {
          const ch = node.child(i)
          if (ch.type.name === 'bulletList' && ch.childCount > 0) { childIndex = i; break }
        }
        if (childIndex === -1) return false
        const liStart = $from.before(d)
        let offset = 1
        for (let i = 0; i < childIndex; i++) offset += node.child(i).nodeSize
        let firstLiStart = liStart + offset + 1
        const target = firstLiStart + 1
        const tr = state.tr.setSelection(TextSelection.create(state.doc, target))
        view.dispatch(tr.scrollIntoView())
        return true
      }
    }
    return false
  }

  const saveTimer = useRef(null)
  const markDirty = () => {
    if (isReadOnly) return
    dirtyRef.current = true
    setDirty(true)
  }
  function queueSave(delay = 700) {
    if (isReadOnly) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(), delay)
  }

  const availableFilters = useMemo(() => ([
    { key: 'todo', label: 'To do' },
    { key: 'in-progress', label: 'In progress' },
    { key: 'done', label: 'Done' }
  ]), [])

  const toggleStatusFilter = (key) => {
    setStatusFilter(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (!next.todo && !next['in-progress'] && !next.done) {
        return { todo: true, 'in-progress': true, done: false }
      }
      return next
    })
  }

  const applyPresetFilter = (preset) => {
    if (preset === 'all') {
      setStatusFilter({ todo: true, 'in-progress': true, done: true })
    } else if (preset === 'active') {
      setStatusFilter({ todo: true, 'in-progress': true, done: false })
    } else if (preset === 'completed') {
      setStatusFilter({ todo: false, 'in-progress': false, done: true })
    }
  }

  const applyStatusFilter = useCallback(() => {
    if (!editor) return
    const root = editor.view.dom
    const hiddenClass = 'filter-hidden'
    const parentClass = 'filter-parent'
    const liNodes = Array.from(root.querySelectorAll('li.li-node'))

    // First pass: clear classes and compute self-archived flag from body text (paragraph only)
    liNodes.forEach(li => {
      li.classList.remove(hiddenClass, parentClass)
      const preset = li.getAttribute('data-archived-self')
      let selfArchived = preset === '1' || preset === 'true'
      if (!selfArchived) {
        const body = li.querySelector(':scope > .li-row .li-content')
        const bodyText = (body?.textContent || '').toLowerCase()
        selfArchived = /@archived\b/.test(bodyText)
      }
      li.dataset.archivedSelf = selfArchived ? '1' : '0'
    })

    // Second pass: propagate archived from ancestors and apply visibility rules
    liNodes.forEach(li => {
      // propagate archived from closest ancestor li
      let archived = li.dataset.archivedSelf === '1'
      let parent = li.parentElement
      while (!archived && parent) {
        if (parent.matches && parent.matches('li.li-node') && parent.dataset.archived === '1') { archived = true; break }
        parent = parent.parentElement
      }
      li.dataset.archived = archived ? '1' : '0'

      const status = li.getAttribute('data-status') || 'todo'
      const hideByStatus = statusFilter[status] === false
      const hideByArchive = !showArchived && archived
      if (hideByStatus || hideByArchive) li.classList.add(hiddenClass)
    })

    // Third pass: ensure parents of visible descendants remain visible but dimmed
    const depthMap = new Map()
    const getDepth = (el) => {
      if (depthMap.has(el)) return depthMap.get(el)
      let depth = 0
      let current = el.parentElement
      while (current) {
        if (current.matches && current.matches('li.li-node')) depth += 1
        current = current.parentElement
      }
      depthMap.set(el, depth)
      return depth
    }

    const sorted = [...liNodes].sort((a, b) => getDepth(b) - getDepth(a))
    sorted.forEach(li => {
      if (!li.classList.contains(hiddenClass)) return
      const descendantVisible = li.querySelector('li.li-node:not(.filter-hidden)')
      if (descendantVisible) {
        li.classList.remove(hiddenClass)
        li.classList.add(parentClass)
      }
    })

  }, [editor, statusFilter, showArchived])

  useEffect(() => { applyStatusFilter() }, [applyStatusFilter])
  useEffect(() => { applyStatusFilterRef.current = applyStatusFilter }, [applyStatusFilter])

  useEffect(() => {
    if (!editor) return
    const handler = () => applyStatusFilter()
    editor.on('update', handler)
    return () => editor.off?.('update', handler)
  }, [editor, applyStatusFilter])
  // Observe DOM changes to ensure filters apply when NodeViews finish mounting (first load, etc.)
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    let t = null
    const observer = new MutationObserver(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => applyStatusFilter(), 50)
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (t) clearTimeout(t) }
  }, [editor, applyStatusFilter])


  useEffect(() => {
    if (!editor || isReadOnly) return
    const dom = editor.view.dom
    const handleDragOver = (event) => {
      if (!draggingRef.current) return

      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    }
    const handleDrop = (event) => {
      const drag = draggingRef.current
      if (!drag) return
      event.preventDefault()
      const dragEl = drag.element
      const pointerY = event.clientY
      const dragList = dragEl ? dragEl.closest('ul') : null
      const candidates = Array.from(dom.querySelectorAll('li.li-node'))
        .filter(el => el !== dragEl && (!dragList || el.closest('ul') === dragList)) // only same-level siblings
      let chosen = null
      let dropAfter = false
      // Compute depth of an li by counting ancestor lis
      const getDepth = (el) => {
        let depth = 0; let cur = el.parentElement
        while (cur) { if (cur.matches && cur.matches('li.li-node')) depth += 1; cur = cur.parentElement }
        return depth
      }
      const infos = candidates.map(el => ({ el, rect: el.getBoundingClientRect(), depth: getDepth(el) }))
        .filter(info => info.rect.height > 0)
        .sort((a, b) => a.rect.top - b.rect.top)
      const inside = infos.filter(info => pointerY >= info.rect.top && pointerY <= info.rect.bottom)
      if (inside.length) {
        // Prefer deepest element under the pointer
        inside.sort((a, b) => b.depth - a.depth)
        const pick = inside[0]
        const mid = pick.rect.top + (pick.rect.height / 2)
        chosen = pick.el
        dropAfter = pointerY > mid
      } else {
        // Find first element below the pointer => drop before it
        const below = infos.find(info => pointerY < info.rect.top)
        if (below) {
          chosen = below.el
          dropAfter = false
        } else if (infos.length) {
          // Otherwise choose the last => drop after it
          chosen = infos[infos.length - 1].el
          dropAfter = true
        }
      }
      const targetId = chosen?.getAttribute('data-id') || null
      if (dragEl && chosen && dragEl.contains(chosen)) {
        console.log('[drop] aborted: target inside drag element', { dragId: drag.id, targetId })
        draggingRef.current = null
        return
      }
      const outline = parseOutline()
      console.log('[drop] request', {
        dragId: drag.id,
        targetId,
        dropAfter,
        pointerY,
        chosenBounds: chosen ? (() => { const rect = chosen.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2 } })() : null
      })
      const moved = moveNodeInOutline(outline, drag.id, targetId, dropAfter ? 'after' : 'before')
      draggingRef.current = null
      if (!moved) return
      console.log('[drop] move applied', { order: moved.map(n => n.id) })
      const docJSON = { type: 'doc', content: [buildList(moved)] }
      editor.commands.setContent(docJSON)
      markDirty()
      queueSave(300)
      applyStatusFilter()
    }
    dom.addEventListener('dragover', handleDragOver)
    dom.addEventListener('drop', handleDrop)
    return () => {
      dom.removeEventListener('dragover', handleDragOver)
      dom.removeEventListener('drop', handleDrop)
    }
  }, [editor, applyStatusFilter, isReadOnly])

  async function doSave() {
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

  useEffect(() => {
    if (!editor || !isReadOnly) return
    if (!initialOutline) return
    const roots = Array.isArray(initialOutline?.roots)
      ? initialOutline.roots
      : Array.isArray(initialOutline)
        ? initialOutline
        : (initialOutline?.roots || [])
    const doc = { type: 'doc', content: [buildList(roots)] }
    editor.commands.setContent(doc)
    dirtyRef.current = false
    setDirty(false)
    applyStatusFilter()
  }, [editor, initialOutline, isReadOnly, applyStatusFilter])


  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onCopy = (e) => {
      try {
        const json = editor.getJSON()
        const html = editor.getHTML()
        e.clipboardData?.setData('application/x-worklog-outline+json', JSON.stringify(json))
        e.clipboardData?.setData('text/html', html)
        // Provide a simple plain text fallback
        const text = dom.innerText || ''
        e.clipboardData?.setData('text/plain', text)
        e.preventDefault()
        pushDebug('copy: outline json placed')
      } catch {}
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [editor])

  useEffect(() => {

    if (!editor || isReadOnly) return
    ;(async () => {
      const data = await getOutline()
      const roots = data.roots || []
      const doc = { type: 'doc', content: [buildList(roots)] }
      editor.commands.setContent(doc)
      dirtyRef.current = false
      setDirty(false)
      pushDebug('loaded outline', { roots: roots.length })
      // Ensure filters (status/archive) apply on first load
      setTimeout(() => applyStatusFilter(), 50)
    })()
  }, [editor, isReadOnly])

  function normalizeBodyNodes(nodes) {
    return nodes.map(node => {
      const copy = { ...node }
      if (copy.type === 'image') {
        copy.attrs = { ...copy.attrs, src: normalizeImageSrc(copy.attrs?.src) }
      }
      if (copy.content) copy.content = normalizeBodyNodes(copy.content)
      return copy
    })
  }

  function parseBodyContent(raw) {
    if (!raw) return []
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray(parsed) ? normalizeBodyNodes(parsed) : []
    } catch {
      return []
    }
  }

  function defaultBody(titleText, dateTokens, hasExtras) {
    if (!hasExtras && (!dateTokens || !dateTokens.length)) {
      return [{ type: 'paragraph', content: [{ type: 'text', text: titleText || 'Untitled' }] }]
    }
    const textContent = [{ type: 'text', text: titleText || 'Untitled' }]
    if (dateTokens?.length) {
      textContent.push({ type: 'text', text: ' ' + dateTokens.map(d => '@' + d).join(' ') })
    }
    return [{ type: 'paragraph', content: textContent }]
  }

  function buildList(nodes) {
    const collapsedSet = forceExpand ? new Set() : loadCollapsed()
    if (!nodes || !nodes.length) {
      return {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          attrs: { dataId: null, status: 'todo', collapsed: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start here' }] }]
        }]
      }
    }
    return {
      type: 'bulletList',
      content: nodes.map(n => {
        const titleText = n.title || 'Untitled'
        const ownDates = Array.isArray(n.ownWorkedOnDates) ? n.ownWorkedOnDates : []
        const rawBody = n.content ?? n.body ?? []
        const body = parseBodyContent(rawBody)
        const hasExtras = body.some(node => node.type !== 'paragraph' || (node.content || []).some(ch => ch.type !== 'text'))
        const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)
        const children = [...bodyContent]
        if (n.children?.length) children.push(buildList(n.children))
        const idStr = String(n.id)
        const titleLower = (titleText || '').toLowerCase()
        const bodyLower = JSON.stringify(bodyContent || []).toLowerCase()
        const archivedSelf = titleLower.includes('@archived') || bodyLower.includes('@archived')
        return {
          type: 'listItem',
          attrs: { dataId: n.id, status: n.status || 'todo', collapsed: collapsedSet.has(idStr), archivedSelf },
          content: children
        }
      })
    }
  }

  function parseOutline() {
    const doc = editor.getJSON(); const results = []
    function walk(node, collector) {
      if (!node?.content) return
      const lists = node.type === 'bulletList' ? [node] : (node.content || []).filter(c => c.type === 'bulletList')
      for (const bl of lists) {
        for (const li of (bl.content || [])) {
          if (li.type !== 'listItem') continue
          const bodyNodes = []
          let subList = null
          ;(li.content || []).forEach(n => {
            if (n.type === 'bulletList' && !subList) subList = n
            else bodyNodes.push(n)
          })
          const para = bodyNodes.find(n => n.type === 'paragraph')
          const title = extractTitle(para)
          const dates = extractDates(li)
          const id = li.attrs?.dataId || null
          const status = li.attrs?.status || 'todo'
          const item = { id, title, status, dates, ownWorkedOnDates: dates, children: [] }
          if (bodyNodes.length) {
            try {
              const cloned = JSON.parse(JSON.stringify(bodyNodes))
              item.body = normalizeBodyNodes(cloned)
            } catch {
              item.body = normalizeBodyNodes(bodyNodes)
            }
            item.content = item.body
            pushDebug('parse: captured body', { id, body: item.body })
          }
          collector.push(item)
          if (subList) walk(subList, item.children)
        }
      }
    }
    walk(doc, results)
    return results
  }

  const cloneOutline = (outline) => (typeof structuredClone === 'function'
    ? structuredClone(outline)
    : JSON.parse(JSON.stringify(outline)))

  function moveNodeInOutline(nodes, dragId, targetId, position = 'before') {
    console.log('[drop] moveNodeInOutline', { dragId, targetId, position })
    if (!dragId || dragId === targetId) return null
    const clone = cloneOutline(nodes)
    const removedInfo = removeNodeById(clone, dragId)
    if (!removedInfo?.node) {
      console.log('[drop] move failed to find dragged node', { dragId })
      return null
    }
    const removed = removedInfo.node
    if (!targetId) {
      clone.push(removed)
      return clone
    }
    if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
      console.log('[drop] insert fallback to end', { dragId, targetId })
      clone.push(removed)
    }
    return clone
  }

  function removeNodeById(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (String(node.id) === String(id)) {
        return { node: nodes.splice(i, 1)[0], index: i }
      }
      if (node.children) {
        const result = removeNodeById(node.children, id)
        if (result?.node) return result
      }
    }
    return { node: null }
  }

  function insertNodeRelative(nodes, targetId, newNode, after) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (String(node.id) === String(targetId)) {
        nodes.splice(after ? i + 1 : i, 0, newNode)
        return true
      }
      if (node.children && insertNodeRelative(node.children, targetId, newNode, after)) return true
    }
    return false
  }

  function extractTitle(paragraphNode) {
    let text = ''
    if (paragraphNode?.content) paragraphNode.content.forEach(n => { if (n.type === 'text') text += n.text })
    return text.replace(DATE_RE, '').replace(/\s{2,}/g, ' ').trim() || 'Untitled'
  }
  function extractDates(listItemNode) {
    const dates = new Set()
    ;(listItemNode.content || []).forEach(n => {
      if (n.type === 'paragraph' && n.content) {
        let t = ''; n.content.forEach(m => { if (m.type === 'text') t += m.text })
        ;(t.match(DATE_RE) || []).forEach(s => dates.add(s.slice(1)))
      }
    })
    return Array.from(dates)
  }

  const closeSlash = ({ preserveMarker = false } = {}) => {
    if (!preserveMarker) {
      const marker = slashMarker.current
      if (marker && editor) {
        const cursorPos = marker.pos + 1 + slashQueryRef.current.length
        editor.chain().setTextSelection(cursorPos).focus().run()
      } else if (editor) {
        editor.chain().focus().run()
      }
      slashMarker.current = null
      updateSlashActive(0)
      setSlashQuery('')
    }
    setSlashOpen(false)
  }
  closeSlashRef.current = closeSlash
  const consumeSlashMarker = useCallback(() => {
    if (!editor) return null
    const query = slashQueryRef.current
    const { state } = editor
    const { $from } = state.selection
    const queryLength = query.length
    const suffix = `/${query}`
    let from = null
    let to = null
    let source = 'cursor'

    if ($from.parent?.isTextblock) {
      try {
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\uFFFC', '\uFFFC')
        if (textBefore && textBefore.endsWith(suffix)) {
          const startOffset = $from.parentOffset - suffix.length
          if (startOffset >= 0) {
            from = $from.start() + startOffset
            to = from + suffix.length
          }
        }
      } catch (err) {
        pushDebug('popup: inspect textBefore failed', { error: err.message })
      }
    }

    if (from === null) {
      const marker = slashMarker.current
      if (!marker) {
        pushDebug('popup: no slash marker to consume')
        setSlashQuery('')
        return null
      }
      from = marker.pos
      const docSize = state.doc.content.size
      const probeEnd = Math.min(marker.pos + 1 + query.length, docSize)
      const slice = state.doc.textBetween(marker.pos, probeEnd, '\n', '\n') || ''
      if (queryLength && slice.startsWith('/' + query)) {
        to = marker.pos + 1 + queryLength
      } else {
        to = marker.pos + 1
      }
      source = 'marker'
    }

    let removed = null
    try {
      pushDebug('popup: doc before slash removal', { doc: editor.getJSON() })
      const ok = editor.chain().focus().deleteRange({ from, to }).run()
      if (ok) {
        removed = { from, to }
        pushDebug('popup: removed slash marker', { from, to, source })
      } else {
        pushDebug('popup: remove slash marker skipped', { from, to, source })
      }
      pushDebug('popup: doc after slash removal', { doc: editor.getJSON() })
    } catch (e) {
      pushDebug('popup: remove slash marker failed', { error: e.message })
    }

    slashMarker.current = null
    setSlashQuery('')
    return removed
  }, [editor, pushDebug])

  const cleanDanglingSlash = useCallback((from) => {
    if (!editor) return
    const char = editor.state.doc.textBetween(from, from + 1, '\n', '\n')
    if (char !== '/') return
    try {
      editor.chain().focus().deleteRange({ from, to: from + 1 }).run()
      pushDebug('popup: cleaned dangling slash', { from })
    } catch (e) {
      pushDebug('popup: clean dangling slash failed', { error: e.message })
    }
  }, [editor])

  // Ensure slash commands that add block nodes (code, details, etc.) stay inside the current list item
  const insertBlockNodeInList = useCallback((nodeName, attrs = {}, options = {}) => {
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
  }, [editor, pushDebug])
  const insertToday = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @' + dayjs().format('YYYY-MM-DD')).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert date today')
  }
  const insertPick = () => {
    // Open our own lightweight date picker popup instead of browser prompt
    const today = dayjs().format('YYYY-MM-DD')
    datePickerValueRef.current = today
    const selFrom = editor?.state?.selection?.from ?? null
    datePickerCaretRef.current = selFrom

    setDatePickerOpen(true)
    closeSlash({ preserveMarker: true })
  }
  const insertArchived = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor.chain().focus().insertContent(' @archived').run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert archived tag')
  }
  const insertCode = () => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    const inserted = insertBlockNodeInList('codeBlock', {}, { select: 'inside' })
    if (inserted) {
      pushDebug('doc after code insert', { doc: editor.getJSON() })
    } else {
      pushDebug('insert code block fallback')
      editor.chain().focus().insertContent({ type: 'codeBlock' }).run()
    }
  const applyPickedDate = useCallback(() => {
    const v = datePickerValueRef.current
    setDatePickerOpen(false)
    if (!v) return
    const caretPos = datePickerCaretRef.current ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + v).run()
    if (slashMarker.current?.pos != null) cleanDanglingSlash(slashMarker.current.pos)
    pushDebug('insert date picked', { v })
  }, [editor, pushDebug])

    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert code block')
  }
  const insertImage = async () => {
    const input = document.createElement('input'); input.type='file'; input.accept='image/*'
    closeSlash({ preserveMarker: true })
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return
      const removed = consumeSlashMarker()
      const result = await uploadImage(f)
      const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
      if (caretPos !== null) {
        editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
      }
      const normalized = normalizeImageSrc(result.url)
      const attrs = { src: normalized }
      if (result?.relativeUrl) attrs['data-file-path'] = result.relativeUrl
      if (result?.id) attrs['data-file-id'] = result.id
      editor.chain().focus().setImage(attrs).run()
      if (removed) cleanDanglingSlash(removed.from)
      pushDebug('insert image', { url: normalized, id: result?.id })
      closeSlash()
    }
    input.click()
  }
  const insertDetails = () => {
    const removed = consumeSlashMarker()
    const inserted = insertBlockNodeInList('detailsBlock')
    if (!inserted) editor.chain().focus().insertContent({ type: 'detailsBlock' }).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert details block')
  }

  const slashCommands = useMemo(() => ([
    { id: 'today', label: 'Date worked on (today)', hint: 'Insert @YYYY-MM-DD for today', keywords: ['today', 'date', 'now'], run: insertToday },
    { id: 'date', label: 'Date worked on (pick)', hint: 'Prompt for a specific date', keywords: ['date', 'pick', 'calendar'], run: insertPick },
    { id: 'archived', label: 'Archive (tag)', hint: 'Insert @archived tag to mark item (and its subtasks) archived', keywords: ['archive','archived','hide'], run: insertArchived },
    { id: 'code', label: 'Code block', hint: 'Insert a multiline code block', keywords: ['code', 'snippet', '```'], run: insertCode },
    { id: 'image', label: 'Upload image', hint: 'Upload and insert an image', keywords: ['image', 'photo', 'upload'], run: insertImage },
    { id: 'details', label: 'Details (inline)', hint: 'Collapsible details block', keywords: ['details', 'summary', 'toggle'], run: insertDetails }
  ]), [insertToday, insertPick, insertArchived, insertCode, insertImage, insertDetails])

  const normalizedSlashQuery = slashQuery.trim().toLowerCase()
  const filteredCommands = useMemo(() => {
    const terms = normalizedSlashQuery.split(/\s+/g).filter(Boolean)
    if (!terms.length) return slashCommands
    const scored = []
    slashCommands.forEach((cmd, index) => {
      const label = cmd.label.toLowerCase()
      const keywords = (cmd.keywords || []).map(k => k.toLowerCase())
      let matches = true
      let score = 0
      for (const term of terms) {
        const labelMatch = label.includes(term)
        const keywordExact = keywords.includes(term)
        const keywordMatch = keywordExact || keywords.some(k => k.includes(term))
        if (!labelMatch && !keywordMatch) { matches = false; break }
        if (keywordExact) score += 3
        else if (keywordMatch) score += 2
        if (labelMatch) score += 1
      }
      if (matches) scored.push({ cmd, score, index })
    })
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
    return scored.map(item => item.cmd)
  }, [normalizedSlashQuery, slashCommands])

  filteredCommandsRef.current = filteredCommands

  useEffect(() => {
    if (!filteredCommands.length) {
      updateSlashActive(0)
    } else if (slashSelectedRef.current >= filteredCommands.length) {
      updateSlashActive(0)
    }
  }, [filteredCommands, updateSlashActive])

  return (
    <div style={{ position:'relative' }}>
      <div className="status-filter-bar">
        <span className="meta" style={{ marginRight: 8 }}>Show:</span>
        {availableFilters.map(opt => (
          <button
            key={opt.key}
            className={`btn pill ${statusFilter[opt.key] ? 'active' : ''}`}
            data-status={opt.key}
            type="button"
            onClick={() => toggleStatusFilter(opt.key)}
          >{opt.label}</button>
        ))}
        <div className="filter-presets">
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('all')}>All</button>
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('active')}>Active</button>
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('completed')}>Completed</button>
        </div>
        <div className="archive-toggle" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="meta">Archived:</span>
          <button
            className={`btn pill ${showArchived ? 'active' : ''}`}
            type="button"
            onClick={() => setShowArchived(v => !v)}
          >{showArchived ? 'Shown' : 'Hidden'}</button>
        </div>
        <div className="search-bar">
          <input
            type="search"
            value={searchQuery}
            placeholder="Search outline…"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')}>Clear</button>
          )}
        </div>
      </div>
      <EditorContent editor={editor} className="tiptap" />
      {imagePreview && (
        <div className="overlay" onClick={() => setImagePreview(null)}>
          <div className="image-modal" onClick={e => e.stopPropagation()}>
            <img src={imagePreview} alt="Preview" />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setImagePreview(null)}>Close</button>
          </div>
        </div>
      )}
      {slashOpen && (
        <div
          ref={menuRef}
          className="slash-menu"
          style={{ left: slashPos.x, top: slashPos.y }}
          onMouseDown={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
          }}
        >
          <input
            type="text"
            value={slashQuery}
            onChange={(e) => {
              updateSlashActive(0)
              setSlashQuery(e.target.value)
            }}
            placeholder="Type a command…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const command = filteredCommands[slashActiveIndex] || filteredCommands[0]
                command?.run()
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                closeSlash()
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (filteredCommands.length) {
                  const next = (slashActiveIndex + 1) % filteredCommands.length
                  updateSlashActive(next)
                }
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (filteredCommands.length) {
                  const next = (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length
                  updateSlashActive(next)
                }
                return
              }
            }}
            ref={slashInputRef}
            autoFocus
          />
          {filteredCommands.length ? (
            filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                onClick={cmd.run}
                className={idx === slashActiveIndex ? 'active' : ''}
              >
            <span className="cmd-label">{cmd.label}</span>
            {cmd.hint ? <span className="cmd-hint">{cmd.hint}</span> : null}
          </button>
        ))
          ) : (
            <div className="slash-empty">No matches</div>
          )}
          {!slashQuery && filteredCommands.length > 0 && (
            <div className="slash-hint">Type to filter commands · Enter to accept</div>
          )}
        </div>
      )}
      {datePickerOpen && (
        <div className="date-picker-pop" style={{ left: slashPos.x, top: slashPos.y }} role="dialog" aria-modal="true">
          <div className="date-picker-title">Pick a date</div>
          <input
            type="date"
            defaultValue={datePickerValueRef.current}
            onChange={(e) => { datePickerValueRef.current = e.target.value }}
          />
          <div className="date-picker-actions">
            <button className="btn" type="button" onClick={applyPickedDate}>Insert</button>
            <button className="btn ghost" type="button" onClick={() => setDatePickerOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showDebug && (
        <div className="debug-pane">
          {debugLines.slice(-40).map((l, i) => <div className="debug-line" key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
