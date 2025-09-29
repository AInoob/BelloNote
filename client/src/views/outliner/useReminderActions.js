import { useCallback } from 'react'
import { STATUS_EMPTY } from './constants.js'
import {
  findReminderTarget,
  deriveReminderUpdate,
  buildReminderParagraph
} from '../../utils/reminderEditor.js'

export function useReminderActions({ editor, markDirty, queueSave, parseOutline, emitOutlineSnapshot }) {
  const applyReminderAction = useCallback((detail) => {
    if (!editor || !detail?.taskId) return
    const { state, view } = editor
    if (!state || !view) return

    const target = findReminderTarget(state.doc, detail.taskId)
    if (!target) return

    const nextReminder = deriveReminderUpdate(target.existingReminder, detail.action, {
      remindAt: detail.remindAt,
      message: detail.message
    })

    const paragraphResult = buildReminderParagraph({
      schema: state.schema,
      paragraphNode: target.paragraphNode,
      action: detail.action,
      reminder: nextReminder
    })

    if (!paragraphResult) return

    let tr = state.tr.replaceWith(
      target.paragraphPos,
      target.paragraphPos + target.paragraphNode.nodeSize,
      paragraphResult.paragraph
    )

    if (detail.action === 'complete') {
      const currentStatus = target.listItemNode.attrs?.status ?? STATUS_EMPTY
      if (currentStatus !== 'done') {
        const nextAttrs = { ...target.listItemNode.attrs, status: 'done' }
        tr = tr.setNodeMarkup(target.listItemPos, undefined, nextAttrs, target.listItemNode.marks)
      }
    }

    view.dispatch(tr.scrollIntoView())
    markDirty()
    queueSave(300)
    const outline = parseOutline()
    emitOutlineSnapshot(outline)
  }, [editor, emitOutlineSnapshot, markDirty, queueSave, parseOutline])

  return { applyReminderAction }
}
