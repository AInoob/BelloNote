const { test, expect } = require('@playwright/test')

const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:4100'

async function resetOutline(request) {
  const response = await request.post(`${API_URL}/api/outline`, { data: { outline: [] } })
  expect(response.ok()).toBeTruthy()
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible()
}

function statusOf(li) {
  return li.getAttribute('data-status')
}

async function typeIntoFirstItem(page, text) {
  const first = page.locator('li.li-node').first()
  await first.locator('p').first().click()
  await page.evaluate(() => {
    const p = document.querySelector('li.li-node p')
    const r = document.createRange(); r.selectNodeContents(p)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  await page.keyboard.type(text)
}

test.beforeEach(async ({ request }) => { await resetOutline(request) })

// 1) New sibling should start with todo regardless of previous status
test('Enter creates a new item with status todo even if previous is done', async ({ page }) => {
  await openOutline(page)

  // Make first item 'done'
  const firstLi = page.locator('li.li-node').first()
  await typeIntoFirstItem(page, 'First')
  const statusBtn = firstLi.locator('.status-chip')
  await statusBtn.click() // todo -> in-progress
  await statusBtn.click() // in-progress -> done
  await expect(firstLi).toHaveAttribute('data-status', 'done')

  // Press Enter to create next item
  await page.keyboard.press('Enter')

  const items = page.locator('li.li-node')
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toHaveAttribute('data-status', '')
})

// 2) New subtask sibling should start with todo even if previous child is done
test('Enter within a child creates next child with status todo', async ({ page }) => {
  await openOutline(page)

  // Create parent and first child
  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child A')
  await page.keyboard.press('Tab') // indent to child of Parent

  const childA = page.locator('li.li-node').filter({ hasText: 'Child A' }).first()
  // Set Child A to done
  const chipA = childA.locator('.status-chip').first()
  await chipA.click(); await chipA.click()
  await expect(childA).toHaveAttribute('data-status', 'done')

  // Press Enter to create Child B
  await page.keyboard.press('Enter')
  const parentLi = page.locator('li.li-node').filter({ hasText: 'Parent' }).first()
  const children = parentLi.locator('li.li-node')
  await expect(children).toHaveCount(2)
  await expect(children.nth(1)).toHaveAttribute('data-status', '')
})
