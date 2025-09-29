import { DOMSerializer, Slice, Node as ProseMirrorNode } from 'prosemirror-model'
import {
  normalizeReminderTokensInJson,
  decodeReminderDisplayTokens,
  stripReminderDisplayBreaks
} from './reminderTokens.js'

export function extractOutlineClipboardPayload({ clipboardData, schema }) {
  if (!clipboardData) return { payload: null }
  const jsonStr = clipboardData.getData('application/x-worklog-outline+json')
  if (!jsonStr) return { payload: null }

  try {
    const parsed = JSON.parse(jsonStr)
    const normalized = normalizeReminderTokensInJson(parsed)
    if (normalized && typeof normalized === 'object' && normalized.type === 'doc') {
      return { payload: { kind: 'doc', doc: normalized } }
    }

    let slice
    try {
      slice = Slice.fromJSON(schema, normalized)
    } catch (err) {
      if (normalized && typeof normalized === 'object' && normalized.content) {
        const node = ProseMirrorNode.fromJSON(schema, { type: 'doc', content: normalized.content })
        slice = new Slice(node.content, 0, 0)
      } else {
        throw err
      }
    }

    if (!slice) return { payload: null }
    return { payload: { kind: 'slice', slice } }
  } catch (error) {
    return { payload: null, error }
  }
}

export function prepareClipboardData({ state }) {
  if (!state) return null
  const { doc, selection, schema } = state
  if (selection.empty) return null

  const slice = selection.content()
  const sliceJson = slice.toJSON()
  const normalizedJson = normalizeReminderTokensInJson(sliceJson)
  const sliceDoc = doc.cut(selection.from, selection.to)
  const serializer = DOMSerializer.fromSchema(schema)
  const fragment = serializer.serializeFragment(sliceDoc.content)
  const container = document.createElement('div')
  container.appendChild(fragment)
  const html = decodeReminderDisplayTokens(container.innerHTML)
  const text = stripReminderDisplayBreaks(sliceDoc.textContent || '')

  return {
    normalizedJson,
    html,
    text
  }
}
