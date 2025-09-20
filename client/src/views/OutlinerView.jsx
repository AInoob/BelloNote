
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, ReactNodeViewRenderer, NodeViewContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import ListItem from '@tiptap/extension-list-item'
import { lowlight } from 'lowlight/lib/core.js'
import dayjs from 'dayjs'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { API_ROOT, absoluteUrl, getOutline, saveOutlineApi, uploadImage } from '../api.js'
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

const TaskListItem = ListItem.extend({
  name: 'listItem',
  draggable: true,
  selectable: true,
  addAttributes() { return { dataId: { default: null }, status: { default: 'todo' }, collapsed: { default: false } } },
  addNodeView() { return ReactNodeViewRenderer(ListItemView) }
})

function ListItemView(props) {
  const { node, updateAttributes, editor, getPos } = props
  const id = node.attrs.dataId
  const status = node.attrs.status || 'todo'
  const collapsed = !!node.attrs.collapsed
  const fallbackIdRef = useRef(id ? String(id) : `temp-${Math.random().toString(36).slice(2, 8)}`)

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
    const idx = STATUS_ORDER.indexOf(status)
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]
    updateAttributes({ status: next })
  }

  const handleDragStart = (event) => {
    try {
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
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', ' ')
        event.dataTransfer.effectAllowed = 'move'
      }
      view.dragging = { slice: view.state.selection.content(), move: true }
      if (event.currentTarget instanceof HTMLElement) {
        const wrapper = event.currentTarget.closest('li.li-node')
        if (wrapper) wrapper.setAttribute('data-id', currentId)
      }
      draggingRef.current = {
        id: currentId,
        element: event.currentTarget instanceof HTMLElement
          ? event.currentTarget.closest('li.li-node')
          : null
      }
    } catch (e) {
      console.error('[drag] failed to select node', e)
    }
  }

  const handleDragEnd = () => {
    draggingRef.current = null
    if (editor?.view) editor.view.dragging = null
  }

  return (
    <li
      className={`li-node ${collapsed ? 'collapsed' : ''}`}
      data-node-view-wrapper=""
      data-status={status}
      data-id={id ? String(id) : fallbackIdRef.current}
      draggable
      onDragEnd={handleDragEnd}
    >
      <div className="li-row">
        <button className="caret" onClick={toggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
        <span
          className="drag-handle"
          draggable
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onDragStart={handleDragStart}
          title="Drag to reorder"
        >⋮⋮</span>
        <button className="status-chip inline" onClick={cycle} title="Click to change status">{STATUS_ICON[status] || '○'}</button>
        <NodeViewContent className="li-content" />
      </div>
    </li>
  )
}

export default function OutlinerView({ onSaveStateChange = () => {}, showDebug=false }) {
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 })
  const [debugLines, setDebugLines] = useState([])
  const menuRef = useRef(null)
  const slashMarker = useRef(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [statusFilter, setStatusFilter] = useState({ todo: true, 'in-progress': true, done: true })
  const draggingRef = useRef(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  const pushDebug = (msg, extra={}) => {
    const line = `${new Date().toLocaleTimeString()} ${msg} ${Object.keys(extra).length? JSON.stringify(extra): ''}`
    setDebugLines(s => [...s.slice(-200), line])
    LOG(msg, extra)
  }

  const editor = useEditor({
    // disable default codeBlock to avoid duplicate name with CodeBlockLowlight
    extensions: [StarterKit.configure({ listItem: false, codeBlock: false }), TaskListItem, Image.configure({ inline:true, allowBase64:true }), CodeBlockLowlight.configure({ lowlight }), WorkDateHighlighter, DetailsBlock],
    content: '<p>Loading…</p>',
    autofocus: true,
    onCreate: () => { pushDebug('editor: ready') },
    onUpdate: () => { markDirty(); queueSave() },
    editorProps: {
      handleTextInput(view, from, to, text) {
        if (text === '/') {
          pushDebug('handleTextInput " / " passthrough', { from, to })
          return false
        }
        return false
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          const e = event
          if (e && e.inputType === 'insertText' && e.data === '/') {
            pushDebug('beforeinput passthrough for " / "')
            return false
          }
          return false
        },
        keypress: (view, event) => {
          if (event.key === '/') {
            pushDebug('keypress passthrough for " / "')
            return false
          }
          return false
        },
        input: (view, event) => {
          const data = event.data || ''
          if (data === '/') {
            pushDebug('input passthrough for " / "')
            return false
          }
          return false
        }
      },
      handleKeyDown(view, event) {
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
          setSlashPos({ x: rect.left, y: rect.bottom + 4 })
          setSlashOpen(true)
          pushDebug('popup: open (keydown)', { key: event.key, char, left: rect.left, top: rect.bottom })
          return true
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
  }, [editor])

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!slashOpen) return
      if (menuRef.current && !menuRef.current.contains(e.target)) { closeSlash(); pushDebug('popup: close by outside click') }
    }
    function onDocKeyDown(e) {
      if (!slashOpen) return
      const isNav = ['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)
      if (e.key === 'Escape') { closeSlash(); e.preventDefault(); pushDebug('popup: close by ESC') }
      else if (!isNav && e.key.length === 1 && e.key !== '/' && e.key !== '?') { closeSlash(); pushDebug('popup: close by typing', { key:e.key }) }
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
  const markDirty = () => { dirtyRef.current = true; setDirty(true) }
  function queueSave(delay = 700) {
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

    liNodes.forEach(li => {
      li.classList.remove(hiddenClass, parentClass)
      const status = li.getAttribute('data-status') || 'todo'
      if (statusFilter[status] === false) li.classList.add(hiddenClass)
    })

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
  }, [editor, statusFilter])

  useEffect(() => { applyStatusFilter() }, [applyStatusFilter])

  useEffect(() => {
    if (!editor) return
    const handler = () => applyStatusFilter()
    editor.on('update', handler)
    return () => editor.off?.('update', handler)
  }, [editor, applyStatusFilter])

  useEffect(() => {
    if (!editor) return
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
      const targetEl = event.target instanceof HTMLElement ? event.target.closest('li.li-node') : null
      const dragEl = drag.element
      if (dragEl && targetEl && dragEl.contains(targetEl)) {
        draggingRef.current = null
        return
      }
      const targetId = targetEl?.getAttribute('data-id') || null
      const outline = parseOutline()
      const dropAfter = targetEl ? (event.clientY > (targetEl.getBoundingClientRect().top + targetEl.getBoundingClientRect().height / 2)) : true
      const moved = moveNodeInOutline(outline, drag.id, targetId, dropAfter ? 'after' : 'before')
      draggingRef.current = null
      if (!moved) return
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
  }, [editor, applyStatusFilter])

  async function doSave() {
    if (!editor) return
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
    if (!editor) return
    ;(async () => {
      const data = await getOutline()
      const roots = data.roots || []
      const doc = { type: 'doc', content: [buildList(roots)] }
      editor.commands.setContent(doc)
      dirtyRef.current = false
      setDirty(false)
      pushDebug('loaded outline', { roots: roots.length })
    })()
  }, [editor])

  const normalizeImageSrc = (src) => absoluteUrl(src)

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
    const collapsedSet = loadCollapsed()
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
        const body = parseBodyContent(n.content)
        const hasExtras = body.some(node => node.type !== 'paragraph' || (node.content || []).some(ch => ch.type !== 'text'))
        const bodyContent = body.length ? body : defaultBody(titleText, ownDates, hasExtras)
        const children = [...bodyContent]
        if (n.children?.length) children.push(buildList(n.children))
        const idStr = String(n.id)
        return {
          type: 'listItem',
          attrs: { dataId: n.id, status: n.status || 'todo', collapsed: collapsedSet.has(idStr) },
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
          const item = { id, title, status, dates, children: [] }
          if (bodyNodes.length) {
            try {
              const cloned = JSON.parse(JSON.stringify(bodyNodes))
              item.body = normalizeBodyNodes(cloned)
            } catch {
              item.body = normalizeBodyNodes(bodyNodes)
            }
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
    if (!dragId || dragId === targetId) return null
    const clone = cloneOutline(nodes)
    const removedInfo = removeNodeById(clone, dragId)
    if (!removedInfo?.node) return null
    const removed = removedInfo.node
    if (!targetId) {
      clone.push(removed)
      return clone
    }
    if (!insertNodeRelative(clone, targetId, removed, position === 'after')) {
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
    if (!preserveMarker) slashMarker.current = null
    setSlashOpen(false)
  }
  const consumeSlashMarker = () => {
    const marker = slashMarker.current
    if (!marker || !editor) return
    const { pos, char } = marker
    try {
      const text = editor.state.doc.textBetween(pos, pos + 1, '\n', '\n')
      if (text === char) {
        editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run()
        pushDebug('popup: removed slash marker', { pos, char })
      }
    } catch (e) {
      pushDebug('popup: remove slash marker failed', { error: e.message })
    }
    slashMarker.current = null
  }
  const insertToday = () => { consumeSlashMarker(); editor.chain().focus().insertContent(' @' + dayjs().format('YYYY-MM-DD')).run(); closeSlash(); pushDebug('insert date today') }
  const insertPick = () => { const v = prompt('Date (YYYY-MM-DD)?', dayjs().format('YYYY-MM-DD')); if (v) { consumeSlashMarker(); editor.chain().focus().insertContent(' @' + v).run(); pushDebug('insert date picked', { v }) } closeSlash() }
  const insertCode = () => {
    consumeSlashMarker()
    const inserted = editor.chain().focus().insertContent([
      { type: 'hardBreak' },
      { type: 'codeBlock', content: [] }
    ]).run()
    if (!inserted) editor.chain().focus().toggleCodeBlock().run()
    closeSlash()
    pushDebug('insert code block')
  }
  const insertImage = async () => {
    const input = document.createElement('input'); input.type='file'; input.accept='image/*'
    closeSlash({ preserveMarker: true })
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return
      consumeSlashMarker()
      const { url } = await uploadImage(f)
      const normalized = normalizeImageSrc(url)
      editor.chain().focus().setImage({ src: normalized }).run()
      pushDebug('insert image', { url: normalized })
      closeSlash()
    }
    input.click()
  }
  const insertDetails = () => { consumeSlashMarker(); editor.chain().focus().insertContent({ type: 'detailsBlock' }).run(); closeSlash(); pushDebug('insert details block') }

  return (
    <div style={{ position:'relative' }}>
      <div className="status-filter-bar">
        <span className="meta" style={{ marginRight: 8 }}>Show:</span>
        {availableFilters.map(opt => (
          <button
            key={opt.key}
            className={`btn pill ${statusFilter[opt.key] ? 'active' : ''}`}
            type="button"
            onClick={() => toggleStatusFilter(opt.key)}
          >{opt.label}</button>
        ))}
        <div className="filter-presets">
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('all')}>All</button>
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('active')}>Active</button>
          <button className="btn ghost" type="button" onClick={() => applyPresetFilter('completed')}>Completed</button>
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
        <div ref={menuRef} className="slash-menu" style={{ left: slashPos.x, top: slashPos.y }} onMouseDown={(e)=>e.preventDefault()}>
          <button onClick={insertToday}>Date worked on (today)</button>
          <button onClick={insertPick}>Date worked on (pick)</button>
          <button onClick={insertCode}>Code block</button>
          <button onClick={insertImage}>Upload image</button>
          <button onClick={insertDetails}>Details (inline)</button>
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
