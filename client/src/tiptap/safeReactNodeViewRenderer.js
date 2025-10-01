// ============================================================================
// Safe React Node View Renderer
// Wrapper for TipTap's ReactNodeViewRenderer that avoids React 18 flushSync warnings
// ============================================================================

import { ReactNodeView } from '@tiptap/react'

// TipTap wraps React node views in a ReactRenderer that calls ReactDOM.flushSync when the
// editor is already initialised. React 18 warns when flushSync runs during a lifecycle
// phase (see OutlinerView warning). We temporarily mark the editor as not initialised so
// the renderer takes the non-flush path and let the microtask render instead.

/**
 * SafeReactNodeView Class
 * Extends TipTap's ReactNodeView to avoid flushSync warnings in React 18
 * Temporarily marks editor as uninitialized during mount to skip flushSync path
 */
class SafeReactNodeView extends ReactNodeView {
  mount() {
    const editor = this.editor
    const hadInitialized = !!(editor && editor.isInitialized)

    // Temporarily mark as uninitialized to avoid flushSync
    if (hadInitialized) {
      editor.isInitialized = false
    }

    try {
      super.mount()
    } finally {
      // Restore initialized state
      if (hadInitialized) {
        editor.isInitialized = true
      }
    }
  }
}

/**
 * Creates a safe React NodeView renderer function
 * @param {React.Component} component - React component to render
 * @param {Object} options - NodeView options
 * @returns {Function} NodeView factory function
 */
export function safeReactNodeViewRenderer(component, options) {
  return (props) => {
    const editor = props?.editor
    if (!editor || !editor.contentComponent) return {}
    return new SafeReactNodeView(component, props, options)
  }
}
