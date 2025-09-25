import { ReactNodeView } from '@tiptap/react'

// TipTap wraps React node views in a ReactRenderer that calls ReactDOM.flushSync when the
// editor is already initialised. React 18 warns when flushSync runs during a lifecycle
// phase (see OutlinerView warning). We temporarily mark the editor as not initialised so
// the renderer takes the non-flush path and let the microtask render instead.

class SafeReactNodeView extends ReactNodeView {
  mount() {
    const editor = this.editor
    const hadInitialized = !!(editor && editor.isInitialized)

    if (hadInitialized) {
      editor.isInitialized = false
    }

    try {
      super.mount()
    } finally {
      if (hadInitialized) {
        editor.isInitialized = true
      }
    }
  }
}

export function safeReactNodeViewRenderer(component, options) {
  return (props) => {
    const editor = props?.editor
    if (!editor || !editor.contentComponent) return {}
    return new SafeReactNodeView(component, props, options)
  }
}
