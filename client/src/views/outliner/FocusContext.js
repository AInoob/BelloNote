import { createContext } from 'react'
import { loadCollapsedSetForRoot, saveCollapsedSetForRoot } from './collapsedState.js'

export const focusContextDefaults = {
  focusRootId: null,
  requestFocus: () => {},
  exitFocus: () => {},
  loadCollapsedSet: loadCollapsedSetForRoot,
  saveCollapsedSet: saveCollapsedSetForRoot,
  forceExpand: false
}

export const FocusContext = createContext(focusContextDefaults)
