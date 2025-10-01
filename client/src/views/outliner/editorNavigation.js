import { TextSelection } from 'prosemirror-state'

/**
 * Move cursor into the first child list item when at the end of a parent item
 * Used for ArrowDown navigation
 * 
 * @param {Object} view - ProseMirror editor view
 * @returns {boolean} True if the cursor was moved, false otherwise
 */
export function moveIntoFirstChild(view) {
  const { state } = view
  const { $from } = state.selection
  
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'listItem') {
      const inPara = $from.parent.type.name === 'paragraph'
      const atEnd = $from.parentOffset === $from.parent.content.size
      const collapsed = node.attrs?.collapsed
      
      if (!inPara || !atEnd || collapsed) return false
      
      // Find the first bulletList child
      let childIndex = -1
      for (let i = 0; i < node.childCount; i++) {
        const ch = node.child(i)
        if (ch.type.name === 'bulletList' && ch.childCount > 0) { 
          childIndex = i
          break 
        }
      }
      
      if (childIndex === -1) return false
      
      // Calculate position of first child list item
      const liStart = $from.before(d)
      let offset = 1
      for (let i = 0; i < childIndex; i++) {
        offset += node.child(i).nodeSize
      }
      const firstLiStart = liStart + offset + 1
      const target = firstLiStart + 1
      
      const tr = state.tr.setSelection(TextSelection.create(state.doc, target))
      view.dispatch(tr.scrollIntoView())
      return true
    }
  }
  
  return false
}

/**
 * Read the focus parameter from the current URL
 * @returns {string|null} The focus task ID from the URL, or null if not present
 */
export function readFocusFromLocation() {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    return url.searchParams.get('focus')
  } catch {
    return null
  }
}

