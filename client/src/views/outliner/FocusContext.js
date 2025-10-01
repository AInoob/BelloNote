// ============================================================================
// Focus Context
// React context for managing outline focus mode (zooming into a subtree)
// ============================================================================

import { createContext } from 'react'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './collapsedState.js'

/**
 * Default values for focus context
 * @property {string|null} focusRootId - ID of the focused root item, or null for full outline
 * @property {Function} requestFocus - Function to focus on a specific item's subtree
 * @property {Function} exitFocus - Function to exit focus mode and return to full outline
 * @property {Function} loadCollapsedSet - Function to load collapsed state for a root
 * @property {Function} saveCollapsedSet - Function to save collapsed state for a root
 * @property {boolean} forceExpand - Whether to force all items expanded (overrides collapsed state)
 */
export const focusContextDefaults = {
  focusRootId: null,
  requestFocus: () => {},
  exitFocus: () => {},
  loadCollapsedSet: loadCollapsedSetForRoot,
  saveCollapsedSet: saveCollapsedSetForRoot,
  forceExpand: false
}

/**
 * React context for outline focus mode
 * Allows zooming into a specific subtree and managing collapsed state per root
 */
export const FocusContext = createContext(focusContextDefaults)
