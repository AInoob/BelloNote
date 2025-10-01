/**
 * Utility functions for working with list items in the outline
 */

import { stripReminderDisplayBreaks } from '../../utils/reminderTokens.js'

/**
 * Gather the text content from a list item node, excluding nested lists
 * This extracts only the "own" text of the list item, not its children
 * 
 * @param {Object} listItemNode - ProseMirror list item node
 * @returns {string} The text content of the list item
 */
export const gatherOwnListItemText = (listItemNode) => {
  if (!listItemNode || listItemNode.type?.name !== 'listItem') return ''
  const parts = []
  
  const visit = (pmNode) => {
    if (!pmNode) return
    const typeName = pmNode.type?.name
    // Skip nested lists
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    
    if (pmNode.isText && pmNode.text) {
      parts.push(pmNode.text)
      return
    }
    
    if (typeof pmNode.forEach === 'function') {
      pmNode.forEach(child => visit(child))
    }
  }
  
  listItemNode.forEach(child => {
    const typeName = child.type?.name
    // Skip nested lists at the top level
    if (typeName === 'bulletList' || typeName === 'orderedList') return
    visit(child)
  })
  
  return stripReminderDisplayBreaks(parts.join(' '))
}

