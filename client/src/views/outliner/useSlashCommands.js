// ============================================================================
// Slash Commands Hook
// React hook for managing slash command menu and command execution
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { parseTagInput } from './tagUtils.js'
import { createCommandExecutors } from './slashCommandExecutors.js'
import { consumeSlashMarker as consumeMarker, cleanDanglingSlash as cleanSlash } from './slashMarkerHelpers.js'

/**
 * Custom hook for slash command functionality in the editor
 * Manages command menu state, filtering, and execution
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {boolean} params.isReadOnly - Whether editor is in read-only mode
 * @param {Function} params.pushDebug - Function to push debug messages
 * @returns {Object} Slash command state, handlers, and refs
 */
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

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Updates the active command index in slash menu
   * @param {number} idx - Index to set as active
   */
  const updateSlashActive = useCallback((idx) => {
    slashSelectedRef.current = idx
    setSlashActiveIndex(idx)
  }, [])

  /**
   * Opens slash command menu at specified coordinates
   * @param {Object} [options={}] - Options
   * @param {number} options.x - X coordinate
   * @param {number} options.y - Y coordinate
   * @param {boolean} [options.preserveMarker=false] - Whether to preserve slash marker
   */
  const openSlashAt = useCallback(({ x, y, preserveMarker = false } = {}) => {
    if (!preserveMarker) {
      slashMarkerRef.current = null
    }
    updateSlashActive(0)
    setSlashPos({ x, y })
    setSlashOpen(true)
    setSlashQuery('')
  }, [updateSlashActive])

  /**
   * Closes slash command menu and optionally restores cursor
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.preserveMarker=false] - Whether to preserve slash marker
   */
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

  // Wrapper functions for extracted helpers
  const consumeSlashMarker = useCallback(() => {
    return consumeMarker({
      editor,
      slashQueryRef,
      slashMarkerRef,
      setSlashQuery,
      pushDebug
    })
  }, [editor, pushDebug])

  const cleanDanglingSlash = useCallback((from) => {
    return cleanSlash(editor, pushDebug, from)
  }, [editor, pushDebug])

  // ============================================================================
  // Command Implementations
  // ============================================================================

  // Create command executors with all necessary dependencies
  const commandExecutors = useMemo(() => createCommandExecutors({
    editor,
    consumeSlashMarker,
    cleanDanglingSlash,
    closeSlash,
    pushDebug,
    setDatePickerOpen,
    datePickerValueRef,
    datePickerCaretRef
  }), [editor, consumeSlashMarker, cleanDanglingSlash, closeSlash, pushDebug])

  const {
    insertToday,
    insertPick,
    insertArchived,
    insertFuture,
    insertSoon,
    insertTagFromSlash,
    insertCode,
    applyPickedDate,
    insertImage,
    insertDetails
  } = commandExecutors

  // ============================================================================
  // Command Definitions
  // ============================================================================

  // Base static commands available in slash menu
  const baseSlashCommands = useMemo(() => ([
    { id: 'today', label: 'Date worked on (today)', hint: 'Insert @YYYY-MM-DD for today', keywords: ['today', 'date', 'now'], run: insertToday },
    { id: 'date', label: 'Date worked on (pick)', hint: 'Prompt for a specific date', keywords: ['date', 'pick', 'calendar'], run: insertPick },
    { id: 'archived', label: 'Archive (tag)', hint: 'Insert @archived tag to mark item (and its subtasks) archived', keywords: ['archive', 'archived', 'hide'], run: insertArchived },
    { id: 'future', label: 'Future (tag)', hint: 'Insert @future tag to mark item not planned soon (and its subtasks)', keywords: ['future', 'later', 'snooze'], run: insertFuture },
    { id: 'soon', label: 'Soon (tag)', hint: 'Insert @soon tag to mark item coming sooner than future (and its subtasks)', keywords: ['soon', 'next', 'upcoming'], run: insertSoon },
    { id: 'code', label: 'Code block', hint: 'Insert a multiline code block', keywords: ['code', 'snippet', '```'], run: insertCode },
    { id: 'image', label: 'Upload image', hint: 'Upload and insert an image', keywords: ['image', 'photo', 'upload'], run: insertImage },
    { id: 'details', label: 'Details (inline)', hint: 'Collapsible details block', keywords: ['details', 'summary', 'toggle'], run: insertDetails }
  ]), [insertArchived, insertCode, insertDetails, insertFuture, insertImage, insertPick, insertSoon, insertToday])

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
