import { useEffect } from 'react'

/**
 * Custom hook to sync task status changes from external events
 * @param {Object} editor - TipTap editor instance
 * @param {Function} scheduleApplyStatusFilter - Function to schedule filter application
 */
export function useTaskStatusSync(editor, scheduleApplyStatusFilter) {
  useEffect(() => {
    if (!editor) return
    const handler = (event) => {
      const detail = event.detail || {}
      const taskId = detail.taskId
      const status = detail.status
      if (!taskId || !status) return
      const view = editor.view
      const { state } = view
      let tr = state.tr
      let mutated = false
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem') return
        if (String(node.attrs.dataId) === String(taskId)) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, status })
          mutated = true
          return false
        }
        return undefined
      })
      if (mutated) {
        view.dispatch(tr)
        scheduleApplyStatusFilter('status-change-event')
      }
    }
    window.addEventListener('worklog:task-status-change', handler)
    return () => window.removeEventListener('worklog:task-status-change', handler)
  }, [editor, scheduleApplyStatusFilter])
}

