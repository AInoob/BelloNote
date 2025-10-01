import { useEffect } from 'react'
import { prepareClipboardData } from '../../utils/outlineClipboard.js'

/**
 * Custom hook to handle copy events in the editor
 * @param {Object} editor - TipTap editor instance
 * @param {Function} pushDebug - Function to push debug message
 */
export function useCopyHandler(editor, pushDebug) {
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onCopy = (e) => {
      try {
        const payload = prepareClipboardData({ state: editor.view.state })
        if (!payload) return

        e.clipboardData?.setData('application/x-worklog-outline+json', JSON.stringify(payload.normalizedJson))
        e.clipboardData?.setData('text/html', payload.html)
        e.clipboardData?.setData('text/plain', payload.text)
        if (typeof window !== 'undefined') {
          window.__WORKLOG_TEST_COPY__ = { text: payload.text, json: JSON.stringify(payload.normalizedJson) }
        }
        e.preventDefault()
        pushDebug('copy: selection exported')
      } catch (err) {
        console.error('[copy] failed', err)
      }
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [editor, pushDebug])
}

