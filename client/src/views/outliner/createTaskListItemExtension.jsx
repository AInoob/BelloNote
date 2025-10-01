import React from 'react'
import ListItem from '@tiptap/extension-list-item'
import { safeReactNodeViewRenderer } from '../../tiptap/safeReactNodeViewRenderer.js'

const STATUS_EMPTY = ''

export function createTaskListItemExtension({ readOnly, draggingState, allowStatusToggleInReadOnly, onStatusToggle, reminderActionsEnabled, ListItemView }) {
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
        futureSelf: { default: false },
        soonSelf: { default: false },
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
