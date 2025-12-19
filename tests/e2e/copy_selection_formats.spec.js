const { test, expect } = require('./test-base')

const SHORT_TIMEOUT = 10000

async function ensureEditorReady(page) {
  const editor = page.locator('.tiptap.ProseMirror').first()
  await page.evaluate(() => { window.__PLAYWRIGHT_TEST__ = true })
  await expect(editor).toBeVisible({ timeout: SHORT_TIMEOUT })
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }, { timeout: SHORT_TIMEOUT }).toBe('ready')
}

test('selection copy buttons appear next to Export/Import and preserve indentation', async ({ page, app }) => {
  await app.resetOutline([])
  await page.goto('/')
  await ensureEditorReady(page)

  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor not ready')
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
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      attrs: { status: 'done' },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }]
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              attrs: { status: 'in-progress' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sibling' }] }]
            }
          ]
        }
      ]
    }
    editor.commands.setContent(doc)
  })

  const copyMd = page.locator('[data-testid="copy-selection-markdown"]')
  const copyText = page.locator('[data-testid="copy-selection-text"]')
  await expect(copyMd).toHaveCount(0)
  await expect(copyText).toHaveCount(0)

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.tiptap.ProseMirror').click()
  await page.keyboard.press(`${modifier}+a`)

  await expect(copyMd).toBeVisible()
  await expect(copyText).toBeVisible()

  // Ensure the controls are rendered in the extra-controls area next to export/import.
  const extraControls = page.locator('.filter-extra-controls')
  await expect(extraControls.locator('[data-testid="copy-selection-controls"]')).toBeVisible()
  await expect(extraControls.locator('[data-testid="export-outline"]')).toBeVisible()
  await expect(extraControls.locator('[data-testid="import-outline"]')).toBeVisible()

  await copyMd.click()
  const mdPayload = await page.evaluate(() => window.__WORKLOG_TEST_SELECTION_COPY__)
  expect(mdPayload?.format).toBe('markdown')
  expect(mdPayload?.text).toContain('- [ ] Parent')
  expect(mdPayload?.text).toContain('  - [x] Child')
  expect(mdPayload?.text).toContain('- [-] Sibling')

  await copyText.click()
  const textPayload = await page.evaluate(() => window.__WORKLOG_TEST_SELECTION_COPY__)
  expect(textPayload?.format).toBe('text')
  expect(textPayload?.text).toContain('- Parent')
  // NBSP indentation (Slack-safe) - expect at least one leading whitespace char before the dash
  expect(textPayload?.text).toMatch(/\n[\s\u00A0]+- Child/)
  expect(textPayload?.text).toContain('- Sibling')
  expect(textPayload?.text).not.toContain('[ ]')
})

test('copying a selected sub-task normalizes indentation so it becomes level 0', async ({ page, app }) => {
  await app.resetOutline([])
  await page.goto('/')
  await ensureEditorReady(page)

  await page.evaluate(() => {
    const editor = window.__WORKLOG_EDITOR_MAIN || window.__WORKLOG_EDITOR
    if (!editor) throw new Error('editor not ready')
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              attrs: { status: '' },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      attrs: { status: '' },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Child' }] },
                        {
                          type: 'bulletList',
                          content: [
                            {
                              type: 'listItem',
                              attrs: { status: '' },
                              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Grandchild' }] }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    editor.commands.setContent(doc)

    // Select only the "Child" listItem node.
    let childPos = null
    editor.state.doc.descendants((node, pos) => {
      if (childPos != null) return false
      if (node.type.name === 'listItem') {
        const firstPara = node.childCount > 0 ? node.child(0) : null
        const firstText = firstPara?.textContent?.trim?.() || ''
        if (firstText === 'Child') {
          childPos = pos
          return false
        }
      }
      return undefined
    })
    if (childPos == null) throw new Error('Child listItem not found')
    editor.chain().focus().setNodeSelection(childPos).run()
  })

  const copyText = page.locator('[data-testid="copy-selection-text"]')
  await expect(copyText).toBeVisible()
  await copyText.click()

  const payload = await page.evaluate(() => window.__WORKLOG_TEST_SELECTION_COPY__)
  expect(payload?.format).toBe('text')

  // Child should be level 0, not indented.
  expect(payload?.text).toMatch(/^- Child/m)
  // Grandchild should be indented relative to Child.
  expect(payload?.text).toMatch(/\n[\s\u00A0]+- Grandchild/)
  // Should not include Parent.
  expect(payload?.text).not.toContain('Parent')
})


