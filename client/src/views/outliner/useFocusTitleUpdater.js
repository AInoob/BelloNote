import { useEffect } from 'react'

/**
 * Custom hook to update focus title on editor updates
 * @param {Object} editor - TipTap editor instance
 * @param {Function} updateFocusTitle - Function to update focus title
 */
export function useFocusTitleUpdater(editor, updateFocusTitle) {
  useEffect(() => {
    if (!editor) return
    const handler = () => updateFocusTitle()
    editor.on('update', handler)
    updateFocusTitle()
    return () => editor.off('update', handler)
  }, [editor, updateFocusTitle])
}

