// ============================================================================
// Reminder Actions Hook
// React hook for applying reminder actions to the editor
// ============================================================================

import { useCallback } from 'react'
import { STATUS_EMPTY } from './constants.js'
import {
  findReminderTarget,
  deriveReminderUpdate,
  buildReminderParagraph
} from '../../utils/reminderEditor.js'

/**
 * Custom hook for handling reminder actions in the outline editor
 * @param {Object} params - Hook parameters
 * @param {Editor} params.editor - TipTap editor instance
 * @param {Function} params.markDirty - Function to mark outline as dirty
 * @param {Function} params.queueSave - Function to queue a save operation
 * @param {Function} params.parseOutline - Function to parse current outline
 * @param {Function} params.emitOutlineSnapshot - Function to emit outline snapshot
 * @returns {Object} Reminder action handlers
 */
export function useReminderActions({ editor, markDirty, queueSave, parseOutline, emitOutlineSnapshot }) {
  /**
   * Applies a reminder action (schedule, dismiss, complete, remove) to a task
   * Updates both the reminder token and task status if needed
   * @param {Object} detail - Action details
   * @param {string} detail.taskId - ID of task to update
   * @param {string} detail.action - Action to perform
   * @param {string} [detail.remindAt] - ISO date for reminder
   * @param {string} [detail.message] - Reminder message
   */
  const applyReminderAction = useCallback((detail) => {
    if (!editor || !detail?.taskId) return
    const { state, view } = editor
    if (!state || !view) return

    // Find the target list item and paragraph in the document
    const target = findReminderTarget(state.doc, detail.taskId)
    if (!target) return

    // Derive the updated reminder state based on the action
    const nextReminder = deriveReminderUpdate(target.existingReminder, detail.action, {
      remindAt: detail.remindAt,
      message: detail.message
    })

    // Build the updated paragraph with the new reminder token
    const paragraphResult = buildReminderParagraph({
      schema: state.schema,
      paragraphNode: target.paragraphNode,
      action: detail.action,
      reminder: nextReminder
    })

    if (!paragraphResult) return

    // Replace the paragraph in the document
    let tr = state.tr.replaceWith(
      target.paragraphPos,
      target.paragraphPos + target.paragraphNode.nodeSize,
      paragraphResult.paragraph
    )

    // If completing the reminder, also mark the task as done
    if (detail.action === 'complete') {
      const currentStatus = target.listItemNode.attrs?.status ?? STATUS_EMPTY
      if (currentStatus !== 'done') {
        const nextAttrs = { ...target.listItemNode.attrs, status: 'done' }
        tr = tr.setNodeMarkup(target.listItemPos, undefined, nextAttrs, target.listItemNode.marks)
      }
    }

    // Dispatch the transaction and trigger save
    view.dispatch(tr.scrollIntoView())
    markDirty()
    queueSave(300)

    // Update the outline snapshot for reminder polling
    const outline = parseOutline()
    emitOutlineSnapshot(outline)
  }, [editor, emitOutlineSnapshot, markDirty, queueSave, parseOutline])

  return { applyReminderAction }
}
