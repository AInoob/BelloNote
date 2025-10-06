import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import dayjs from 'dayjs'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import ListItem from '@tiptap/extension-list-item'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { STATUS_EMPTY, STATUS_ICON, STATUS_ORDER } from './constants.js'
import { FocusContext, focusContextDefaults } from './FocusContext.js'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './collapsedState.js'
import {
  computeReminderDisplay,
  parseReminderTokenFromText,
  reminderIsDue,
  stripReminderDisplayBreaks
} from '../../utils/reminderTokens.js'
import { safeReactNodeViewRenderer } from '../../tiptap/safeReactNodeViewRenderer.js'
import {
  applySplitStatusAdjustments,
  findListItemDepth,
  runSplitListItemWithSelection
} from './listCommands.js'
import { gatherOwnListItemText } from './listItemUtils.js'
import {
  createReminderActionHandler,
  handleStatusKeyDown as handleStatusKeyDownUtil,
  cycleStatus as cycleStatusUtil
} from './reminderActionHandlers.js'
import {
  handleDragStart as handleDragStartUtil,
  handleDragEnd as handleDragEndUtil
} from './taskItemDragHandlers.js'

function ListItemView({
  node,
  updateAttributes,
  editor,
  getPos,
  readOnly = false,
  draggingState,
  allowStatusToggleInReadOnly = false,
  onStatusToggle = null,
  reminderActionsEnabled: reminderActionsEnabledProp = false
}) {
  const id = node.attrs.dataId
  const statusAttr = node.attrs.status ?? STATUS_EMPTY
  const collapsed = !!node.attrs.collapsed
  const tags = Array.isArray(node.attrs.tags) ? node.attrs.tags.map((t) => String(t || '').toLowerCase()) : []
  const fallbackIdRef = useRef(id ? String(id) : `temp-${Math.random().toString(36).slice(2, 8)}`)
  const justDraggedRef = useRef(false)
  const draggingRef = draggingState || { current: null }
  const focusConfig = useContext(FocusContext) || focusContextDefaults
  const focusRootId = focusConfig.focusRootId ?? null
  const loadCollapsedSet = focusConfig.loadCollapsedSet || loadCollapsedSetForRoot
  const saveCollapsedSet = focusConfig.saveCollapsedSet || saveCollapsedSetForRoot
  const requestFocus = focusConfig.requestFocus || (() => {})
  const reminderControlsEnabled = reminderActionsEnabledProp
  const ownBodyText = useMemo(() => gatherOwnListItemText(node), [node])
  const ownBodyTextAttr = useMemo(() => (ownBodyText || '').replace(/\s+/g, ' ').trim(), [ownBodyText])
  const reminder = useMemo(() => parseReminderTokenFromText(ownBodyText), [ownBodyText])
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false)
  const defaultCustomDate = () => {
    const base = reminder?.remindAt ? dayjs(reminder.remindAt) : dayjs().add(30, 'minute')
    if (!base || !base.isValid?.()) return dayjs().add(30, 'minute').format('YYYY-MM-DDTHH:mm')
    return base.format('YYYY-MM-DDTHH:mm')
  }
  const [customMode, setCustomMode] = useState(false)
  const [customDate, setCustomDate] = useState(defaultCustomDate)
  const [reminderError, setReminderError] = useState('')
  const reminderMenuRef = useRef(null)
  const rowRef = useRef(null)
  const [isActive, setIsActive] = useState(false)
  const reminderAreaRef = useRef(null)
  const [reminderOffset, setReminderOffset] = useState(null)
  const [reminderInlineGap, setReminderInlineGap] = useState(0)
  const [reminderTop, setReminderTop] = useState(0)

  useEffect(() => {
    if (id) fallbackIdRef.current = String(id)
  }, [id])

  useEffect(() => {
    if (!editor || typeof getPos !== 'function') return
    const updateSelectionState = () => {
      try {
        const pos = getPos()
        if (typeof pos !== 'number') {
          setIsActive(false)
          return
        }
        const { from, to } = editor.state.selection
        const end = pos + node.nodeSize
        const intersects = (from >= pos && from <= end) || (to >= pos && to <= end) || (from <= pos && to >= end)
        const hasFocus = editor?.view?.hasFocus?.()
        setIsActive(Boolean(intersects && hasFocus))
      } catch {
        setIsActive(false)
      }
    }
    const handleBlur = () => setIsActive(false)
    updateSelectionState()
    editor.on('selectionUpdate', updateSelectionState)
    editor.on('transaction', updateSelectionState)
    editor.on('focus', updateSelectionState)
    editor.on('blur', handleBlur)
    return () => {
      editor.off('selectionUpdate', updateSelectionState)
      editor.off('transaction', updateSelectionState)
      editor.off('focus', updateSelectionState)
      editor.off('blur', handleBlur)
    }
  }, [editor, getPos, node])

  useEffect(() => {
    const key = id ? String(id) : fallbackIdRef.current
    if (!key) return
    const collapsedSet = loadCollapsedSet(focusRootId)
    const shouldCollapse = collapsedSet.has(key)
    if (shouldCollapse !== collapsed) updateAttributes({ collapsed: shouldCollapse })
  }, [id, collapsed, updateAttributes, loadCollapsedSet, focusRootId])

  useEffect(() => {
    if (!reminderControlsEnabled || !reminderMenuOpen) return
    const handleClick = (event) => {
      if (reminderMenuRef.current && !reminderMenuRef.current.contains(event.target)) {
        setReminderMenuOpen(false)
        setCustomMode(false)
        setReminderError('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [reminderMenuOpen, reminderControlsEnabled])

  const toggleCollapse = () => {
    const next = !collapsed
    updateAttributes({ collapsed: next })
    const key = id ? String(id) : fallbackIdRef.current
    if (!key) return
    const set = loadCollapsedSet(focusRootId)
    if (next) set.add(key)
    else set.delete(key)
    saveCollapsedSet(focusRootId, set)
  }

  const readCurrentDomId = () => {
    const li = rowRef.current?.closest('li.li-node')
    if (!li) return id ? String(id) : fallbackIdRef.current
    return li.getAttribute('data-id') || li.dataset?.id || (id ? String(id) : fallbackIdRef.current)
  }

  const ensurePersistentTaskId = useCallback(async () => {
    let currentId = readCurrentDomId()
    if (currentId && !String(currentId).startsWith('new-')) return currentId
    window.dispatchEvent(new CustomEvent('worklog:request-save'))
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      currentId = readCurrentDomId()
      if (currentId && !String(currentId).startsWith('new-')) return currentId
    }
    throw new Error('Task must be saved before setting a reminder')
  }, [id])

  const closeReminderMenu = useCallback(() => {
    setReminderMenuOpen(false)
    setCustomMode(false)
    setCustomDate('')
    setReminderError('')
  }, [])

  const scheduleAfterMinutes = useCallback(async (minutes) => {
    if (!reminderControlsEnabled) return
    try {
      setReminderError('')
      const realId = await ensurePersistentTaskId()
      const remindAt = dayjs().add(minutes, 'minute').toDate().toISOString()
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'schedule', taskId: String(realId), remindAt }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled])

  const handleCustomSubmit = useCallback(async (event) => {
    event.preventDefault()
    if (!reminderControlsEnabled) return
    if (!customDate) {
      setReminderError('Select a date and time')
      return
    }
    try {
      const realId = await ensurePersistentTaskId()
      const dateValue = new Date(customDate)
      if (Number.isNaN(dateValue.valueOf())) throw new Error('Invalid date')
      const remindAt = dateValue.toISOString()
      window.dispatchEvent(new CustomEvent('worklog:reminder-action', {
        detail: { action: 'schedule', taskId: String(realId), remindAt }
      }))
      closeReminderMenu()
    } catch (err) {
      setReminderError(err?.message || 'Failed to schedule reminder')
    }
  }, [closeReminderMenu, customDate, ensurePersistentTaskId, reminderControlsEnabled])

  const handleDismissReminder = useCallback(
    createReminderActionHandler('dismiss', ensurePersistentTaskId, closeReminderMenu, setReminderError, reminderControlsEnabled),
    [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled]
  )

  const handleCompleteReminder = useCallback(
    createReminderActionHandler('complete', ensurePersistentTaskId, closeReminderMenu, setReminderError, reminderControlsEnabled),
    [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled]
  )

  const handleRemoveReminder = useCallback(
    createReminderActionHandler('remove', ensurePersistentTaskId, closeReminderMenu, setReminderError, reminderControlsEnabled),
    [closeReminderMenu, ensurePersistentTaskId, reminderControlsEnabled]
  )

  const handleStatusKeyDown = useCallback((event) => {
    handleStatusKeyDownUtil(
      event,
      readOnly,
      allowStatusToggleInReadOnly,
      getPos,
      editor,
      findListItemDepth,
      runSplitListItemWithSelection,
      applySplitStatusAdjustments
    )
  }, [allowStatusToggleInReadOnly, editor, getPos, readOnly])

  const cycle = (event) => {
    cycleStatusUtil(
      event,
      readOnly,
      allowStatusToggleInReadOnly,
      rowRef,
      node,
      STATUS_ORDER,
      STATUS_EMPTY,
      updateAttributes,
      onStatusToggle,
      id,
      fallbackIdRef,
      editor,
      getPos,
      findListItemDepth
    )
  }

  const handleDragStart = (event) => {
    handleDragStartUtil(
      event,
      readOnly,
      id,
      fallbackIdRef,
      updateAttributes,
      getPos,
      editor,
      draggingRef,
      justDraggedRef
    )
  }

  const handleDragEnd = () => {
    handleDragEndUtil(readOnly, draggingRef, editor, justDraggedRef)
  }

  const handleToggleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    toggleCollapse()
  }

  const reminderDismissed = reminder?.status === 'dismissed'
  const reminderCompleted = reminder?.status === 'completed'
  const activeReminder = reminder?.status === 'incomplete'
  const reminderDue = reminderIsDue(reminder)
  const reminderDisplay = useMemo(() => computeReminderDisplay(reminder), [reminder])
  const reminderSummary = reminderDisplay.summary
  const reminderButtonLabel = reminderSummary
    ? `Reminder options (${reminderSummary})`
    : 'Reminder options'

  useEffect(() => {
    if (!reminderControlsEnabled) {
      setReminderOffset(null)
      setReminderInlineGap(0)
      setReminderTop(0)
    }
  }, [reminderControlsEnabled])

  useLayoutEffect(() => {
    if (!reminderControlsEnabled) return
    const measure = () => {
      const areaEl = reminderAreaRef.current
      const rowEl = rowRef.current
      if (!areaEl || !rowEl) return
      const rowRect = rowEl.getBoundingClientRect()
      const mainEl = rowEl.querySelector(':scope > .li-main')
      if (!mainEl) return
      const mainRect = mainEl.getBoundingClientRect()
      if (!mainRect || !mainRect.width) return
      const areaRect = areaEl.getBoundingClientRect()
      const areaWidth = areaRect?.width ?? 0
      const contentEl = rowEl.querySelector(':scope > .li-main .li-content')
      let firstRect = null
      if (contentEl) {
        const paragraph = contentEl.querySelector('p')
        if (paragraph) {
          const range = document.createRange()
          range.selectNodeContents(paragraph)
          const rects = range.getClientRects()
          if (rects.length > 0) {
            firstRect = Array.from(rects).reduce((acc, rect) => (
              !acc || rect.right > acc.right ? rect : acc
            ), null)
          } else {
            const rect = range.getBoundingClientRect()
            if (rect && rect.width) firstRect = rect
          }
          range.detach?.()
        }
        if (!firstRect) {
          const fallbackCandidate = contentEl.querySelector(':scope > *:not(ul):not(ol)')
          if (fallbackCandidate) {
            const range = document.createRange()
            range.selectNodeContents(fallbackCandidate)
            const rects = range.getClientRects()
            if (rects.length > 0) {
              firstRect = Array.from(rects).reduce((acc, rect) => (
                !acc || rect.right > acc.right ? rect : acc
              ), null)
            } else {
              const rect = range.getBoundingClientRect()
              if (rect && rect.width) firstRect = rect
            }
            range.detach?.()
          }
        }
        if (!firstRect) {
          const fallbackRect = contentEl.getBoundingClientRect()
          if (fallbackRect && fallbackRect.width) firstRect = fallbackRect
        }
      }
      if (!firstRect) firstRect = mainRect
      const textRight = firstRect?.right ?? mainRect.left
      const spacing = 6
      const hostWidth = Math.max(rowRect?.width ?? 0, mainRect.width)
      const maxOffset = Math.max(0, hostWidth - areaWidth - 4)
      const desiredOffset = Math.max(0, (textRight - mainRect.left) + spacing)
      const offset = Math.min(maxOffset, desiredOffset)
      setReminderOffset((prev) => {
        if (prev !== null && Math.abs(prev - offset) < 0.5) return prev
        return offset
      })
      const reserveCeiling = Math.max(0, Math.floor(hostWidth - 20))
      const reserveGap = areaWidth
        ? Math.max(
            0,
            Math.min(Math.ceil(Math.max(areaWidth + spacing, spacing + 6)), reserveCeiling)
          )
        : 0
      setReminderInlineGap((prev) => {
        if (Math.abs(prev - reserveGap) < 0.5) return prev
        return reserveGap
      })

      const textTop = firstRect?.top ?? mainRect.top
      const textHeight = firstRect?.height ?? 0
      const areaHeight = areaRect?.height ?? 0
      let verticalOffset = Math.max(0, textTop - mainRect.top)
      if (areaHeight && textHeight) {
        const textMid = (textTop - mainRect.top) + textHeight / 2
        verticalOffset = Math.max(0, textMid - areaHeight / 2)
      }
      setReminderTop((prev) => {
        if (Math.abs(prev - verticalOffset) < 0.5) return prev
        return verticalOffset
      })
    }

    measure()
    const resizeObserver = new ResizeObserver(() => measure())
    if (rowRef.current) resizeObserver.observe(rowRef.current)
    if (reminderAreaRef.current) resizeObserver.observe(reminderAreaRef.current)
    const contentEl = rowRef.current?.querySelector(':scope > .li-main .li-content')
    const mutationObserver = contentEl ? new MutationObserver(() => measure()) : null
    if (contentEl && mutationObserver) {
      mutationObserver.observe(contentEl, { childList: true, subtree: true, characterData: true })
    }
    window.addEventListener('resize', measure)
    return () => {
      resizeObserver.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [reminderControlsEnabled, reminderMenuOpen, activeReminder, collapsed])

  return (
    <NodeViewWrapper
      as="li"
      className={`li-node ${collapsed ? 'collapsed' : ''}`}
      data-status={statusAttr}
      data-id={id ? String(id) : fallbackIdRef.current}
      data-archived-self={node.attrs.archivedSelf ? '1' : '0'}
      data-archived={node.attrs.archivedSelf ? '1' : '0'}
      data-tags-self={tags.join(',')}
      data-body-text={ownBodyTextAttr}
      draggable={!readOnly}
      onDragEnd={readOnly ? undefined : handleDragEnd}
    >
      <div className={`li-row ${isActive ? 'is-selected' : ''}`} ref={rowRef}>
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
          onKeyDown={handleStatusKeyDown}
          onPointerEnter={(event) => {
            if (typeof window !== 'undefined') {
              if (!event.currentTarget.dataset.scrollCapture) {
                const scrollValue = Number.isFinite(window.scrollY) ? String(window.scrollY) : ''
                event.currentTarget.dataset.scrollCapture = scrollValue
              }
            }
            if (!event.currentTarget.dataset.rowOffsetCapture) {
              const rowEl = rowRef.current
              if (rowEl && typeof rowEl.getBoundingClientRect === 'function') {
                const rect = rowEl.getBoundingClientRect()
                const topValue = Number.isFinite(rect.top) ? String(rect.top) : ''
                event.currentTarget.dataset.rowOffsetCapture = topValue
              }
            }
          }}
          onMouseDown={(event) => {
            if (typeof window !== 'undefined') {
              const value = Number.isFinite(window.scrollY) ? String(window.scrollY) : ''
              event.currentTarget.dataset.scrollCapture = value
            }
            const rowEl = rowRef.current
            if (rowEl && typeof rowEl.getBoundingClientRect === 'function') {
              const rect = rowEl.getBoundingClientRect()
              const topValue = Number.isFinite(rect.top) ? String(rect.top) : ''
              event.currentTarget.dataset.rowOffsetCapture = topValue
            }
          }}
        >
          {statusAttr === STATUS_EMPTY ? '' : (STATUS_ICON[statusAttr] ?? '○')}
        </button>
        <div className="li-main">
          <NodeViewContent
            className="li-content"
            style={reminderControlsEnabled ? { '--reminder-inline-gap': `${reminderInlineGap}px` } : undefined}
          />
          {reminderControlsEnabled && (
            <div
              ref={reminderAreaRef}
              className={`li-reminder-area ${reminderOffset !== null ? 'floating' : ''} ${activeReminder ? 'has-reminder' : ''} ${reminderDue ? 'due' : ''} ${reminderDismissed ? 'dismissed' : ''}`}
              style={reminderOffset !== null ? { left: `${reminderOffset}px`, top: `${reminderTop}px` } : undefined}
              contentEditable={false}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="reminder-toggle icon-only"
                aria-label={reminderButtonLabel}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setReminderError('')
                  setCustomMode(false)
                  setCustomDate(defaultCustomDate())
                  setReminderMenuOpen((value) => !value)
                }}
              >
                <span aria-hidden>⋮</span>
              </button>
              {reminderMenuOpen && (
                <div className="reminder-menu" ref={reminderMenuRef}>
                  <div className="reminder-menu-section">
                    <div className="menu-heading">Remind me in</div>
                    <div className="menu-buttons">
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(30)}>30 minutes</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(60)}>1 hour</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(180)}>3 hours</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(1380)}>23 hours</button>
                      <button type="button" className="btn small" onClick={() => scheduleAfterMinutes(1440)}>24 hours</button>
                    </div>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        setCustomMode((value) => !value)
                        setReminderError('')
                        setCustomDate(defaultCustomDate())
                      }}
                    >Custom…</button>
                    {customMode && (
                      <form className="menu-custom" onSubmit={handleCustomSubmit}>
                        <input
                          type="datetime-local"
                          value={customDate}
                          onChange={(event) => setCustomDate(event.target.value)}
                          required
                        />
                        <div className="menu-buttons">
                          <button type="submit" className="btn small">Set reminder</button>
                        </div>
                      </form>
                    )}
                  </div>
                  {reminder && (
                    <div className="reminder-menu-section">
                      <div className="menu-heading">Actions</div>
                      {activeReminder && (
                        <>
                          <button type="button" className="btn small" onClick={handleCompleteReminder}>Mark complete</button>
                          {!reminderDismissed && (
                            <button type="button" className="btn small ghost" onClick={handleDismissReminder}>Dismiss</button>
                          )}
                        </>
                      )}
                      <button type="button" className="btn small ghost" onClick={handleRemoveReminder}>Remove reminder</button>
                    </div>
                  )}
                  {reminderError && (
                    <div className="reminder-error">{reminderError}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export function createTaskListItemExtension({
  readOnly,
  draggingState,
  allowStatusToggleInReadOnly,
  onStatusToggle,
  reminderActionsEnabled
}) {
  return ListItem.extend({
    name: 'listItem',
    draggable: !readOnly,
    selectable: true,
    addAttributes() {
      return {
        dataId: { default: null },
        status: { default: STATUS_EMPTY },
        collapsed: { default: false },
        archivedSelf: { default: false },
        tags: { default: [] }
      }
    },
    addNodeView() {
      return safeReactNodeViewRenderer((props) => (
        <ListItemView
          {...props}
          readOnly={readOnly}
          draggingState={draggingState}
          allowStatusToggleInReadOnly={allowStatusToggleInReadOnly}
          onStatusToggle={onStatusToggle}
          reminderActionsEnabled={reminderActionsEnabled}
        />
      ))
    }
  })
}
