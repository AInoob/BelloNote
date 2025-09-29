import { Extension } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import {
  REMINDER_TOKEN_REGEX,
  parseReminderTokenFromText,
  computeReminderDisplay,
  encodeReminderDisplayTokens
} from '../utils/reminderTokens.js'

function createReminderChip({ token, reminder, taskId }) {
  const display = computeReminderDisplay(reminder)
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

  const activate = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const li = chip.closest('li.li-node')
    if (!li) return
    const toggle = li.querySelector('.li-reminder-area .reminder-toggle')
    if (!toggle) return
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (typeof toggle.focus === 'function') toggle.focus()
  }

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

export const ReminderTokenInline = Extension.create({
  name: 'reminderTokenInline',
  addProseMirrorPlugins() {
    return [new Plugin({
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
        decorations: (state) => {
          const { doc } = state
          const decorations = []
          doc.descendants((node, pos) => {
            if (node.type?.name !== 'paragraph') return
            const $pos = state.doc.resolve(pos)
            let taskId = null
            for (let depth = $pos.depth; depth >= 0; depth -= 1) {
              const ancestor = $pos.node(depth)
              if (!ancestor) continue
              if (ancestor.type?.name === 'listItem') {
                taskId = ancestor.attrs?.dataId ?? null
                break
              }
            }
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
                decorations.push(Decoration.inline(from, to, {
                  class: 'reminder-token-hidden',
                  style: 'display: none;'
                }))
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
