import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { TextSelection } from 'prosemirror-state'
import { uploadImage, absoluteUrl } from '../../api.js'
import { parseTagInput } from './tagUtils.js'

export function useSlashCommands({ editor, isReadOnly, pushDebug }) {
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 })
  const [slashQuery, setSlashQuery] = useState('')
  const slashQueryRef = useRef('')
  const slashMarkerRef = useRef(null)
  const slashInputRef = useRef(null)
  const slashSelectedRef = useRef(0)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const filteredCommandsRef = useRef([])
  const menuRef = useRef(null)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerValueRef = useRef(dayjs().format('YYYY-MM-DD'))
  const datePickerCaretRef = useRef(null)

  const normalizeImageSrc = useCallback((src) => absoluteUrl(src), [])

  const updateSlashActive = useCallback((idx) => {
    slashSelectedRef.current = idx
    setSlashActiveIndex(idx)
  }, [])

  const openSlashAt = useCallback(({ x, y, preserveMarker = false } = {}) => {
    if (!preserveMarker) {
      slashMarkerRef.current = null
    }
    updateSlashActive(0)
    setSlashPos({ x, y })
    setSlashOpen(true)
    setSlashQuery('')
  }, [updateSlashActive])

  const closeSlash = useCallback(({ preserveMarker = false } = {}) => {
    if (!preserveMarker) {
      const marker = slashMarkerRef.current
      if (marker && editor) {
        const cursorPos = marker.pos + 1 + slashQueryRef.current.length
        editor.chain().setTextSelection(cursorPos).focus().run()
      } else if (editor) {
        editor.chain().focus().run()
      }
      slashMarkerRef.current = null
      updateSlashActive(0)
      setSlashQuery('')
    }
    setSlashOpen(false)
  }, [editor, updateSlashActive])

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
      const marker = slashMarkerRef.current
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

    slashMarkerRef.current = null
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
  }, [editor, pushDebug])

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

  const insertToday = useCallback(() => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + dayjs().format('YYYY-MM-DD')).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert date today')
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, pushDebug])

  const insertPick = useCallback(() => {
    const today = dayjs().format('YYYY-MM-DD')
    datePickerValueRef.current = today
    const selFrom = editor?.state?.selection?.from ?? null
    datePickerCaretRef.current = selFrom

    setDatePickerOpen(true)
    closeSlash({ preserveMarker: true })
  }, [closeSlash, editor])

  const insertTagged = useCallback((tag) => {
    const removed = consumeSlashMarker()
    const caretPos = removed?.from ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(` @${tag}`).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug(`insert ${tag} tag`)
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, pushDebug])

  const insertArchived = useCallback(() => insertTagged('archived'), [insertTagged])

  const insertTagFromSlash = useCallback((tagInfo) => {
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
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, pushDebug])

  const insertCode = useCallback(() => {
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
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert code block')
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, insertBlockNodeInList, pushDebug])

  const applyPickedDate = useCallback(() => {
    const value = datePickerValueRef.current
    setDatePickerOpen(false)
    if (!value) return
    const caretPos = datePickerCaretRef.current ?? editor?.state?.selection?.from ?? null
    if (caretPos !== null) {
      editor?.commands?.setTextSelection({ from: caretPos, to: caretPos })
    }
    editor?.chain().focus().insertContent(' @' + value).run()
    if (slashMarkerRef.current?.pos != null) cleanDanglingSlash(slashMarkerRef.current.pos)
    pushDebug('insert date picked', { value })
  }, [cleanDanglingSlash, editor, pushDebug])

  const insertImage = useCallback(() => {
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
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, normalizeImageSrc, pushDebug])

  const insertDetails = useCallback(() => {
    const removed = consumeSlashMarker()
    const inserted = insertBlockNodeInList('detailsBlock')
    if (!inserted) editor?.chain().focus().insertContent({ type: 'detailsBlock' }).run()
    if (removed) cleanDanglingSlash(removed.from)
    closeSlash()
    pushDebug('insert details block')
  }, [cleanDanglingSlash, closeSlash, consumeSlashMarker, editor, insertBlockNodeInList, pushDebug])

  const baseSlashCommands = useMemo(() => ([
    { id: 'today', label: 'Date worked on (today)', hint: 'Insert @YYYY-MM-DD for today', keywords: ['today', 'date', 'now'], run: insertToday },
    { id: 'date', label: 'Date worked on (pick)', hint: 'Prompt for a specific date', keywords: ['date', 'pick', 'calendar'], run: insertPick },
    { id: 'archived', label: 'Archive (tag)', hint: 'Insert @archived tag to mark item (and its subtasks) archived', keywords: ['archive', 'archived', 'hide'], run: insertArchived },
    { id: 'code', label: 'Code block', hint: 'Insert a multiline code block', keywords: ['code', 'snippet', '```'], run: insertCode },
    { id: 'image', label: 'Upload image', hint: 'Upload and insert an image', keywords: ['image', 'photo', 'upload'], run: insertImage },
    { id: 'details', label: 'Details (inline)', hint: 'Collapsible details block', keywords: ['details', 'summary', 'toggle'], run: insertDetails }
  ]), [insertArchived, insertCode, insertDetails, insertImage, insertPick, insertToday])

  const parsedTagQuery = useMemo(() => {
    const trimmed = slashQuery.trim()
    if (!trimmed || !trimmed.startsWith('#')) return null
    return parseTagInput(trimmed)
  }, [slashQuery])

  const dynamicTagCommand = useMemo(() => {
    if (!parsedTagQuery) return null
    if (typeof window !== 'undefined') window.__WORKLOG_DEBUG_TAG_QUERY = parsedTagQuery.canonical
    return {
      id: `tag:${parsedTagQuery.canonical}`,
      label: `Add tag #${parsedTagQuery.display}`,
      hint: 'Insert a tag for this task',
      keywords: ['tag', 'hash', parsedTagQuery.canonical],
      run: () => insertTagFromSlash(parsedTagQuery)
    }
  }, [insertTagFromSlash, parsedTagQuery])

  const slashCommands = useMemo(() => (
    dynamicTagCommand ? [dynamicTagCommand, ...baseSlashCommands] : baseSlashCommands
  ), [baseSlashCommands, dynamicTagCommand])

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

  useEffect(() => { slashQueryRef.current = slashQuery }, [slashQuery])

  useEffect(() => {
    if (!editor) return
    const updateSlashState = () => {
      const marker = slashMarkerRef.current
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
          closeSlash()
          return
        }
        const query = text.slice(1)
        if (slashQueryRef.current !== query) {
          if (typeof window !== 'undefined') window.__WORKLOG_DEBUG_SLASH_QUERY = query
          setSlashQuery(query)
        }
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
  }, [editor, closeSlash])

  useEffect(() => {
    if (!slashOpen) return undefined
    updateSlashActive(0)
    const frame = requestAnimationFrame(() => {
      slashInputRef.current?.focus()
      slashInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [slashOpen, updateSlashActive])

  useEffect(() => {
    if (!slashOpen) return undefined
    function onDocMouseDown(event) {
      if (!menuRef.current || menuRef.current.contains(event.target)) return
      closeSlash()
      pushDebug('popup: close by outside click')
    }
    function onDocKeyDown(event) {
      if (!slashOpen) return
      const isNav = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)
      const insideMenu = menuRef.current && menuRef.current.contains(event.target)
      if (event.key === 'Escape') {
        closeSlash()
        event.preventDefault()
        pushDebug('popup: close by ESC')
      } else if (!insideMenu && !isNav && event.key.length === 1 && event.key !== '/' && event.key !== '?') {
        closeSlash()
        pushDebug('popup: close by typing', { key: event.key })
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [closeSlash, pushDebug, slashOpen])

  const handleKeyDown = useCallback((view, event) => {
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
        closeSlash()
        return true
      }
    }

    if (!editor) return false

    const isSlashKey = (event.key === '/' || event.code === 'Slash') && !event.shiftKey
    if (isSlashKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const inCode = view.state.selection.$from.parent.type.name === 'codeBlock'
      if (inCode) {
        pushDebug('keydown "/" ignored in code block')
        return false
      }
      event.preventDefault()
      event.stopPropagation()
      const char = '/'
      const { from } = editor.state.selection
      slashMarkerRef.current = { pos: from, char }
      editor.chain().focus().insertContent(char).run()
      let rect
      try {
        const after = editor.state.selection.from
        rect = view.coordsAtPos(after)
      } catch (e) {
        rect = { left: 0, bottom: 0 }
        pushDebug('popup: coords fail', { error: e.message })
      }
      openSlashAt({ x: rect.left, y: rect.bottom + 4, preserveMarker: true })
      pushDebug('popup: open (keydown)', { key: event.key, char, left: rect.left, top: rect.bottom })
      return true
    }

    return false
  }, [closeSlash, editor, isReadOnly, pushDebug, slashOpen, updateSlashActive])

  const handleSlashInputKeyDown = useCallback((event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const command = filteredCommands[slashActiveIndex] || filteredCommands[0]
      command?.run()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSlash()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredCommands.length) {
        const next = (slashActiveIndex + 1) % filteredCommands.length
        updateSlashActive(next)
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredCommands.length) {
        const next = (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length
        updateSlashActive(next)
      }
    }
  }, [closeSlash, filteredCommands, slashActiveIndex, updateSlashActive])

  return {
    slashOpen,
    slashPos,
    slashQuery,
    setSlashQuery,
    slashActiveIndex,
    updateSlashActive,
    slashInputRef,
    filteredCommands,
    closeSlash,
    menuRef,
    datePickerOpen,
    setDatePickerOpen,
    datePickerValueRef,
    applyPickedDate,
    handleKeyDown,
    handleSlashInputKeyDown,
    openSlashAt
  }
}
