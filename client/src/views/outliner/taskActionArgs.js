const TASK_ACTION_KEYS = [
  'readOnly',
  'allowStatusToggleInReadOnly',
  'getPos',
  'editor',
  'findListItemDepth',
  'runSplitListItemWithSelection',
  'applySplitStatusAdjustments'
]

export function getTaskActionArgs(source = {}) {
  const result = {}
  for (const key of TASK_ACTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key]
    }
  }
  return result
}
