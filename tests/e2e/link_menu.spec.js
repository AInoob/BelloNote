const { test, expect } = require('./test-base')

const LINK_URL = 'https://example.com'
const SHORT_TIMEOUT = 10000

async function ensureEditorReady(page) {
  const editor = page.locator('.tiptap.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    return text && text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: SHORT_TIMEOUT }).not.toBe('loading')
  return editor
}

test.describe('link menu popover', () => {
  test.beforeEach(async ({ app }) => {
    await app.resetOutline([])
  })

  test('offers remove, open, and copy actions when clicking a link', async ({ page }) => {
    await page.goto('/')
    const editor = await ensureEditorReady(page)

    await page.evaluate((href) => {
      const editorInstance = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
      if (!editorInstance) throw new Error('editor not ready')
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: { status: 'todo' },
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Visit ' },
                      {
                        type: 'text',
                        text: 'Example',
                        marks: [{ type: 'link', attrs: { href } }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
      editorInstance.commands.setContent(doc)
    }, LINK_URL)

    const saveIndicator = page.locator('.save-indicator').first()
    await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT })

    const link = page.locator(`a[href="${LINK_URL}"]`).first()
    await expect(link).toHaveCount(1)

    await page.evaluate(() => {
      window.__ORIGINAL_OPEN__ = window.open
      window.__TEST_OPEN_CALLS__ = []
      window.open = (...args) => {
        window.__TEST_OPEN_CALLS__.push(args)
        return null
      }
    })

    const menu = page.locator('[aria-label="Link options"]').first()

    await link.click()
    await expect(menu).toBeVisible()
    await expect(menu.locator('button')).toHaveCount(3)

    const removeButton = menu.getByRole('button', { name: /Remove link/ })
    await expect(removeButton).toBeEnabled()

    const copyButton = menu.getByRole('button', { name: /Copy link|Copied!/ })
    await copyButton.click()
    await expect(copyButton).toContainText('Copied!')

    const openButton = menu.getByRole('button', { name: /Open link in new tab/ })
    await openButton.click()
    await expect(menu).toBeHidden()

    await expect.poll(async () => {
      const calls = await page.evaluate(() => window.__TEST_OPEN_CALLS__ || [])
      return calls.length
    }, { timeout: 2000 }).toBe(1)

    const recordedCalls = await page.evaluate(() => window.__TEST_OPEN_CALLS__)
    expect(recordedCalls[0][0]).toBe(LINK_URL)
    expect(recordedCalls[0][1]).toBe('_blank')
    expect(recordedCalls[0][2]).toContain('noopener')

    await link.click()
    await expect(menu).toBeVisible()
    await removeButton.click()
    await expect(menu).toBeHidden()

    await expect(page.locator(`a[href="${LINK_URL}"]`)).toHaveCount(0)
    await expect(editor).toContainText('Example')

    await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT })

    await page.evaluate(() => {
      if (window.__ORIGINAL_OPEN__) {
        window.open = window.__ORIGINAL_OPEN__
        delete window.__ORIGINAL_OPEN__
      }
      delete window.__TEST_OPEN_CALLS__
    })
  })
})
