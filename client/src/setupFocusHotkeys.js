let initialized = false

export function setupFocusHotkeys() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.__WORKLOG_FOCUS_HOTKEYS_READY = true
  const handler = (event) => {
    if (!event) return
    const body = document.body
    if (!body || !body.classList.contains('focus-mode')) return
    const isEscape = event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    const isNavShortcut = event.key === '[' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
    if (!isEscape && !isNavShortcut) return
    const exitButton = document.querySelector('.focus-banner button')
    if (!exitButton) return
    event.preventDefault()
    exitButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }
  window.addEventListener('keydown', handler, true)
}
