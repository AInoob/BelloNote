// ============================================================================
// Outline Clipboard Utilities
// Handles custom clipboard format for outline copy/paste with reminder tokens
// ============================================================================

import { DOMSerializer, Slice, Node as ProseMirrorNode } from 'prosemirror-model'
import {
  normalizeReminderTokensInJson,
  decodeReminderDisplayTokens,
  stripReminderDisplayBreaks
} from './reminderTokens.js'

/**
 * Extracts outline data from clipboard if custom format is present
 * Normalizes reminder tokens in the process
 * @param {Object} params - Parameters
 * @param {DataTransfer} params.clipboardData - Clipboard data from paste event
 * @param {Schema} params.schema - ProseMirror schema
 * @returns {Object} Object with payload (doc or slice) and optional error
 */
export function extractOutlineClipboardPayload({ clipboardData, schema }) {
  if (!clipboardData) return { payload: null }
  const jsonStr = clipboardData.getData('application/x-worklog-outline+json')
  if (!jsonStr) return { payload: null }

  try {
    const parsed = JSON.parse(jsonStr)
    const normalized = normalizeReminderTokensInJson(parsed)

    // If it's a full document, return as doc payload
    if (normalized && typeof normalized === 'object' && normalized.type === 'doc') {
      return { payload: { kind: 'doc', doc: normalized } }
    }

    // Otherwise, construct a slice for insertion
    let slice
    try {
      slice = Slice.fromJSON(schema, normalized)
    } catch (err) {
      // Fallback: wrap content in a doc node first
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

/**
 * Prepares clipboard data for copy operation
 * Generates JSON, HTML, and plain text representations
 * @param {Object} params - Parameters
 * @param {EditorState} params.state - ProseMirror editor state
 * @returns {Object|null} Object with normalizedJson, html, and text, or null
 */
export function prepareClipboardData({ state }) {
  if (!state) return null
  const { doc, selection, schema } = state
  if (selection.empty) return null

  // Extract selection as JSON and normalize reminder tokens
  const slice = selection.content()
  const sliceJson = slice.toJSON()
  const normalizedJson = normalizeReminderTokensInJson(sliceJson)

  // Serialize to HTML with decoded reminder display tokens
  const sliceDoc = doc.cut(selection.from, selection.to)
  const serializer = DOMSerializer.fromSchema(schema)
  const fragment = serializer.serializeFragment(sliceDoc.content)
  const container = document.createElement('div')
  container.appendChild(fragment)
  const html = decodeReminderDisplayTokens(container.innerHTML)

  // Extract plain text with cleaned reminder display breaks
  const text = stripReminderDisplayBreaks(sliceDoc.textContent || '')

  return {
    normalizedJson,
    html,
    text
  }
}
