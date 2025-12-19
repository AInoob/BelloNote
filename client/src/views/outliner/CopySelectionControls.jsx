import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatEditorSelection } from './selectionCopyFormats.js'

function copyTextToClipboard(value) {
  if (!value) return Promise.resolve(false)
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
  if (clipboard?.writeText) {
    return clipboard.writeText(value).then(() => true).catch(() => false)
  }
  if (typeof document === 'undefined') return Promise.resolve(false)
  try {
    const el = document.createElement('textarea')
    el.value = value
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return Promise.resolve(true)
  } catch {
    return Promise.resolve(false)
  }
}

export function CopySelectionControls({ editor }) {
  const [hasSelection, setHasSelection] = useState(false)
  const [status, setStatus] = useState('')
  const statusTimerRef = useRef(null)

  const updateHasSelection = useCallback(() => {
    try {
      const empty = editor?.state?.selection?.empty
      setHasSelection(!empty)
    } catch {
      setHasSelection(false)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    updateHasSelection()
    editor.on('selectionUpdate', updateHasSelection)
    editor.on('transaction', updateHasSelection)
    return () => {
      editor.off('selectionUpdate', updateHasSelection)
      editor.off('transaction', updateHasSelection)
    }
  }, [editor, updateHasSelection])

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
  }, [])

  const handleCopy = useCallback(async (format) => {
    if (!editor?.view?.state) return
    const text = formatEditorSelection(editor.view.state, { format })
    if (!text) return

    if (typeof window !== 'undefined' && window.__PLAYWRIGHT_TEST__) {
      window.__WORKLOG_TEST_SELECTION_COPY__ = { format, text }
    }

    const ok = await copyTextToClipboard(text)
    setStatus(ok ? 'Copied!' : 'Copy failed')
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatus(''), 1200)
  }, [editor])

  const ariaLabel = useMemo(() => (
    hasSelection ? 'Copy selection formats' : 'Copy selection formats (no selection)'
  ), [hasSelection])

  if (!hasSelection) return null

  return (
    <div className="copy-selection-controls" data-testid="copy-selection-controls" aria-label={ariaLabel}>
      <button
        type="button"
        className="btn ghost"
        data-testid="copy-selection-markdown"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleCopy('markdown')}
      >Copy Markdown</button>
      <button
        type="button"
        className="btn ghost"
        data-testid="copy-selection-text"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => handleCopy('text')}
      >Copy Text</button>
      {status && (
        <span className="export-import-status" data-testid="copy-selection-status">{status}</span>
      )}
    </div>
  )
}


