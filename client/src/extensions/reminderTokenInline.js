import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import {
  REMINDER_TOKEN_REGEX,
  parseReminderTokenFromText,
  computeReminderDisplay,
  encodeReminderDisplayTokens
} from '../utils/reminderTokens.js'
import { clamp, collectChangedTextblockRanges } from '../utils/range.js'
import { buildBlockDecorationSet, patchBlockDecorationSet } from './utils/blockDecorations.js'

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
    const toggle = li.querySelector(':scope > .li-row > .li-main > .li-reminder-area .reminder-toggle')
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

const reminderKey = new PluginKey('reminderTokenInline')

function extractReminderMatches(text) {
  const matches = []
  const regex = new RegExp(REMINDER_TOKEN_REGEX.source, 'gi')
  let match
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]
    matches.push({
      raw,
      index: match.index,
      length: raw.length,
      reminder: parseReminderTokenFromText(raw)
    })
  }
  return matches
}

function findTaskId(doc, pos) {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const ancestor = $pos.node(depth)
    if (ancestor?.type?.name === 'listItem') {
      return ancestor.attrs?.dataId ?? null
    }
  }
  return null
}

function collectReminderDecorations(node, pos, doc, cache) {
  if (node.type?.name !== 'paragraph') return []
  const taskId = findTaskId(doc, pos)
  const decorations = []
  node.forEach((child, offset) => {
    if (!child.isText) return
    const text = child.text || ''
    if (!text || !text.includes('[[') || !text.includes('reminder')) return
    let matches = cache.get(child)
    if (!matches) {
      matches = extractReminderMatches(text)
      cache.set(child, matches)
    }
    matches.forEach(({ raw, index, length, reminder }) => {
      const from = pos + 1 + offset + index
      const to = from + length
      decorations.push(Decoration.inline(from, to, {
        class: 'reminder-token-hidden',
        style: 'display: none;'
      }))
      if (reminder) {
        const chip = () => createReminderChip({ token: raw, reminder, taskId })
        const keyParts = [from, reminder.status || 'unknown', reminder.remindAt || '']
        decorations.push(Decoration.widget(from, chip, { key: `reminder-chip-${keyParts.join('-')}` }))
      }
    })
  })
  return decorations
}

function buildDecos(doc, cache) {
  return buildBlockDecorationSet(doc, (node, pos) => collectReminderDecorations(node, pos, doc, cache))
}

function patchDecos(decoSet, doc, ranges, cache) {
  return patchBlockDecorationSet({
    decoSet,
    doc,
    ranges,
    collect: (node, pos) => collectReminderDecorations(node, pos, doc, cache),
    beforeCollect: (node) => {
      if (node.type?.name !== 'paragraph') return false
      node.forEach((child) => {
        if (child.isText) cache.delete(child)
      })
      return true
    }
  })
}

export const ReminderTokenInline = Extension.create({
  name: 'reminderTokenInline',
  addProseMirrorPlugins() {
    const cache = new WeakMap()
    return [new Plugin({
      key: reminderKey,
      state: {
        init: (_, { doc }) => buildDecos(doc, cache),
        apply: (tr, oldDecos, _oldState, newState) => {
          const mapped = (oldDecos || DecorationSet.empty).map(tr.mapping, tr.doc)
          if (!tr.docChanged) return mapped
          const changed = collectChangedTextblockRanges(tr)
          if (!changed.length) return mapped
          return patchDecos(mapped, newState.doc, changed, cache)
        }
      },
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
        decorations(state) {
          return this.getState(state)
        }
      }
    })]
  }
})
