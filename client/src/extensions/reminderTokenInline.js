// ============================================================================
// Reminder Token Inline Extension
// TipTap extension for rendering reminder tokens as interactive chips
// ============================================================================

import { Extension } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import {
  REMINDER_TOKEN_REGEX,
  parseReminderTokenFromText,
  computeReminderDisplay,
  encodeReminderDisplayTokens
} from '../utils/reminderTokens.js'

// ============================================================================
// Chip Creation
// ============================================================================

/**
 * Creates an interactive reminder chip DOM element
 * Displays reminder status and provides click interaction to open reminder menu
 * @param {Object} params - Chip parameters
 * @param {string} params.token - Raw reminder token string
 * @param {Object} params.reminder - Parsed reminder object
 * @param {string|number|null} params.taskId - Associated task ID
 * @returns {HTMLElement} Configured reminder chip element
 */
function createReminderChip({ token, reminder, taskId }) {
  const display = computeReminderDisplay(reminder)

  // Create chip element with appropriate styling
  const chip = document.createElement('span')
  chip.className = 'reminder-inline-chip'
  if (display.due) chip.classList.add('due')
  if (reminder?.status === 'dismissed') chip.classList.add('dismissed')
  if (reminder?.status === 'completed') chip.classList.add('completed')
  chip.textContent = display.inlineLabel || 'Reminder'
  chip.title = display.summary || 'Reminder'
  chip.setAttribute('role', 'button')
  chip.setAttribute('tabindex', '0')
  chip.dataset.reminderToken = token
  if (taskId != null) chip.dataset.reminderTaskId = String(taskId)

  /**
   * Activates the reminder by clicking the reminder toggle button in the list item
   * Opens the reminder menu for the associated task
   */
  const activate = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const li = chip.closest('li.li-node')
    if (!li) return
    const toggle = li.querySelector(':scope > .li-row > .li-main > .li-reminder-area .reminder-toggle')
    if (!toggle) return
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (typeof toggle.focus === 'function') toggle.focus()
  }

  // Set up event listeners
  chip.addEventListener('click', activate)
  chip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') activate(event)
  })
  chip.addEventListener('mousedown', (event) => {
    // Prevent editor selection jumps when interacting with the chip
    event.preventDefault()
  })

  return chip
}

// ============================================================================
// TipTap Extension Definition
// ============================================================================

/**
 * ReminderTokenInline TipTap Extension
 * Renders reminder tokens as interactive chips and manages display encoding
 * Features:
 * - Hides raw reminder tokens in the editor
 * - Displays interactive reminder chips in their place
 * - Auto-encodes display-only content with zero-width spaces
 * - Extracts task ID from parent list item for chip interaction
 */
export const ReminderTokenInline = Extension.create({
  name: 'reminderTokenInline',
  addProseMirrorPlugins() {
    return [new Plugin({
      /**
       * Encodes reminder display tokens after document changes
       * Wraps display-only content in zero-width spaces to prevent editing
       */
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some(tr => tr.docChanged)) return null
        let tr = newState.tr
        let mutated = false
        newState.doc.descendants((node, pos) => {
          if (!node.isTextblock) return
          node.forEach((child, offset) => {
            if (!child.isText) return
            const text = child.text || ''
            const encoded = encodeReminderDisplayTokens(text)
            if (encoded !== text) {
              const from = pos + 1 + offset
              const to = from + text.length
              tr = tr.insertText(encoded, from, to)
              mutated = true
            }
          })
        })
        if (mutated) {
          tr.setMeta('addToHistory', false)
          return tr
        }
        return null
      },
      props: {
        /**
         * Creates decorations for reminder tokens
         * Hides raw tokens and displays chips in their place
         */
        decorations: (state) => {
          const { doc } = state
          const decorations = []
          doc.descendants((node, pos) => {
            if (node.type?.name !== 'paragraph') return
            const $pos = state.doc.resolve(pos)

            // Find parent list item's task ID
            let taskId = null
            for (let depth = $pos.depth; depth >= 0; depth -= 1) {
              const ancestor = $pos.node(depth)
              if (!ancestor) continue
              if (ancestor.type?.name === 'listItem') {
                taskId = ancestor.attrs?.dataId ?? null
                break
              }
            }

            // Find and decorate reminder tokens
            node.forEach((child, childOffset) => {
              if (!child.isText) return
              const text = child.text || ''
              const globalRegex = new RegExp(REMINDER_TOKEN_REGEX.source, 'gi')
              let match
              while ((match = globalRegex.exec(text)) !== null) {
                const raw = match[0]
                const reminder = parseReminderTokenFromText(raw)
                const from = pos + 1 + childOffset + match.index
                const to = from + raw.length

                // Hide the raw token
                decorations.push(Decoration.inline(from, to, {
                  class: 'reminder-token-hidden',
                  style: 'display: none;'
                }))

                // Display a chip in its place
                if (reminder) {
                  const chip = () => createReminderChip({ token: raw, reminder, taskId })
                  const keyParts = [from, reminder.status || 'unknown', reminder.remindAt || '']
                  decorations.push(Decoration.widget(from, chip, { key: `reminder-chip-${keyParts.join('-')}` }))
                }
              }
            })
          })
          return decorations.length ? DecorationSet.create(doc, decorations) : null
        }
      }
    })]
  }
})
