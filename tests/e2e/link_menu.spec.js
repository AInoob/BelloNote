const { test, expect } = require('./test-base')

const LINK_URL = 'https://example.com'
const SHORT_TIMEOUT = 10000
const SLACK_ARCHIVE_URL = 'https://airwallex.slack.com/archives/C09HP3Y6QBT/p1762751764791599?thread_ts=1762751610.577339&cid=C09HP3Y6QBT'
const SLACK_THREAD_URL = 'https://airwallex.slack.com/messages/C09HP3Y6QBT/p1762751764791599?thread_ts=1762751610.577339'
const SLACK_DEEP_LINK = 'slack://channel?team=T0SEVS2SG&id=C09HP3Y6QBT&message=1762751764.791599&thread_ts=1762751610.577339'

async function ensureEditorReady(page) {
  const editor = page.locator('.tiptap.ProseMirror').first()
  await page.evaluate(() => {
    window.__PLAYWRIGHT_TEST__ = true
  })
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent)
    return text && text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: SHORT_TIMEOUT }).not.toBe('loading')
  return editor
}

async function setEditorContent(page, doc) {
  await page.evaluate((payload) => {
    const editorInstance = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editorInstance) throw new Error('editor not ready')
    editorInstance.commands.setContent(payload)
  }, doc)
}

test.describe('link menu popover', () => {
  test.beforeEach(async ({ app }) => {
    await app.resetOutline([])
  })

  test('offers remove, open, and copy actions when clicking a link', async ({ page }) => {
    await page.goto('/')
    const editor = await ensureEditorReady(page)

    const baseDoc = {
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
                      marks: [{ type: 'link', attrs: { href: LINK_URL } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    await setEditorContent(page, baseDoc)

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

  test('link popover stays anchored while scrolling', async ({ page }) => {
    await page.goto('/')
    await ensureEditorReady(page)
    const fillerItems = Array.from({ length: 40 }, (_, index) => ({
      type: 'listItem',
      attrs: { status: 'todo' },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Filler row ${index + 1}` }]
        }
      ]
    }))
    fillerItems.unshift({
      type: 'listItem',
      attrs: { status: 'todo' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Scroll target ' },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: LINK_URL } }] }
          ]
        }
      ]
    })
    const doc = { type: 'doc', content: [{ type: 'bulletList', content: fillerItems }] }
    await setEditorContent(page, doc)

    const saveIndicator = page.locator('.save-indicator').first()
    await expect(saveIndicator).toHaveText('Saved', { timeout: SHORT_TIMEOUT })

    const link = page.locator(`a[href="${LINK_URL}"]`).first()
    await link.scrollIntoViewIfNeeded()
    await link.click()

    const menu = page.locator('[aria-label="Link options"]').first()
    await expect(menu).toBeVisible()

    const initial = await page.evaluate((selector) => {
      const linkEl = document.querySelector(selector)
      const menuEl = document.querySelector('[aria-label="Link options"]')
      if (!linkEl || !menuEl) return null
      const linkRect = linkEl.getBoundingClientRect()
      const menuRect = menuEl.getBoundingClientRect()
      return {
        delta: menuRect.top - linkRect.bottom,
        horizontal: menuRect.left - linkRect.left
      }
    }, `a[href="${LINK_URL}"]`)
    expect(initial).not.toBeNull()

    await page.evaluate(() => window.scrollBy(0, 150))
    await page.waitForTimeout(100)

    const afterScroll = await page.evaluate((selector) => {
      const linkEl = document.querySelector(selector)
      const menuEl = document.querySelector('[aria-label="Link options"]')
      if (!linkEl || !menuEl) return null
      const linkRect = linkEl.getBoundingClientRect()
      const menuRect = menuEl.getBoundingClientRect()
      return {
        delta: menuRect.top - linkRect.bottom,
        horizontal: menuRect.left - linkRect.left
      }
    }, `a[href="${LINK_URL}"]`)
    expect(afterScroll).not.toBeNull()
    expect(Math.abs(initial.delta - afterScroll.delta)).toBeLessThan(5)
  })

  test('slack links expose deep link actions', async ({ page }) => {
    await page.goto('/')
    await ensureEditorReady(page)
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
                    { type: 'text', text: 'Discuss in ' },
                    {
                      type: 'text',
                      text: 'Slack',
                      marks: [{ type: 'link', attrs: { href: SLACK_ARCHIVE_URL } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    await setEditorContent(page, doc)

    await page.evaluate(() => {
      window.__ORIGINAL_OPEN__ = window.open
      window.__TEST_OPEN_CALLS__ = []
      window.open = (...args) => {
        window.__TEST_OPEN_CALLS__.push(args)
        return null
      }
      window.__TEST_CLIPBOARD_TEXT__ = null
      window.__TEST_SLACK_DEEPLINKS__ = []
      const slackHandler = (event) => {
        window.__TEST_SLACK_DEEPLINKS__.push(event?.detail?.href || null)
      }
      window.__TEST_SLACK_HANDLER__ = slackHandler
      window.addEventListener('worklog:slack-deeplink', slackHandler)
      const stub = (text) => {
        window.__TEST_CLIPBOARD_TEXT__ = text
        return Promise.resolve()
      }
      const clipboard = navigator.clipboard
      if (clipboard && typeof clipboard.writeText === 'function') {
        window.__ORIGINAL_CLIPBOARD_WRITE_TEXT__ = clipboard.writeText.bind(clipboard)
        clipboard.writeText = stub
        window.__CREATED_TEST_CLIPBOARD__ = false
      } else {
        window.__ORIGINAL_CLIPBOARD_WRITE_TEXT__ = undefined
        window.__CREATED_TEST_CLIPBOARD__ = true
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: stub }
        })
      }
    })

    const link = page.locator(`a[href="${SLACK_ARCHIVE_URL}"]`).first()
    await link.click()
    const menu = page.locator('[aria-label="Link options"]').first()
    await expect(menu).toBeVisible()
    await expect(menu.locator('button')).toHaveCount(5)

    await menu.getByRole('button', { name: /Open in Slack app/i }).click()
    await expect(menu).toBeHidden()

    await expect.poll(async () => {
      return page.evaluate(() => (window.__TEST_SLACK_DEEPLINKS__ || []).length)
    }, { timeout: 2000 }).toBe(1)
    const slackEvents = await page.evaluate(() => window.__TEST_SLACK_DEEPLINKS__)
    expect(slackEvents[0]).toBe(SLACK_DEEP_LINK)

    await link.click()
    await expect(menu).toBeVisible()
    const slackCopyButton = menu.getByRole('button', { name: /Copy Slack thread link|Slack thread copied!/i })
    await slackCopyButton.click()

    await expect.poll(async () => {
      return page.evaluate(() => window.__TEST_CLIPBOARD_TEXT__)
    }, { timeout: 2000 }).toBe(SLACK_THREAD_URL)

    await page.evaluate(() => {
      if (window.__ORIGINAL_OPEN__) {
        window.open = window.__ORIGINAL_OPEN__
        delete window.__ORIGINAL_OPEN__
      }
      if (window.__TEST_SLACK_HANDLER__) {
        window.removeEventListener('worklog:slack-deeplink', window.__TEST_SLACK_HANDLER__)
        delete window.__TEST_SLACK_HANDLER__
      }
      if (window.__CREATED_TEST_CLIPBOARD__) {
        delete navigator.clipboard
        delete window.__CREATED_TEST_CLIPBOARD__
      } else if (window.__ORIGINAL_CLIPBOARD_WRITE_TEXT__) {
        navigator.clipboard.writeText = window.__ORIGINAL_CLIPBOARD_WRITE_TEXT__
      }
      delete window.__ORIGINAL_CLIPBOARD_WRITE_TEXT__
      delete window.__TEST_OPEN_CALLS__
      delete window.__TEST_CLIPBOARD_TEXT__
    })
  })
})
