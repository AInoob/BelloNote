const { test: base, expect } = require('@playwright/test')

const test = base.extend({
  page: async ({ page }, use) => {
    const consoleMessages = []
    const pageErrors = []

    const consoleListener = (message) => {
      const type = message.type()
      if (type === 'error') {
        consoleMessages.push({
          type,
          text: message.text(),
          location: message.location?.url || '',
        })
      }
    }

    const pageErrorListener = (error) => {
      pageErrors.push(error)
    }

    page.on('console', consoleListener)
    page.on('pageerror', pageErrorListener)

    await use(page)

    page.off('console', consoleListener)
    page.off('pageerror', pageErrorListener)

    if (pageErrors.length || consoleMessages.length) {
      const errorLines = []
      consoleMessages.forEach((msg) => {
        errorLines.push(`[console.${msg.type}] ${msg.text}${msg.location ? ` (${msg.location})` : ''}`)
      })
      pageErrors.forEach((err) => {
        errorLines.push(`[pageerror] ${err.message || err.toString?.() || String(err)}`)
      })
      throw new Error(`Browser logged errors:\n${errorLines.join('\n')}`)
    }
  }
})

module.exports = { test, expect }
