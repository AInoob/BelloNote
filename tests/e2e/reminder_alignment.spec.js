const { test, expect } = require('./test-base')

test.describe.configure({ mode: 'serial' })

let ORIGIN = null

async function ensureBackendReady(request) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${ORIGIN}/api/health`)
      if (!response.ok()) return 'down'
      const body = await response.json()
      return body?.ok ? 'ready' : 'down'
    } catch {
      return 'down'
    }
  }, { message: 'backend should respond to health check', timeout: 10000 }).toBe('ready')
}

async function resetOutline(request, outline) {
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline  }, headers: { 'x-playwright-test': '1' } })
  expect(response.ok()).toBeTruthy()
}

function seedNestedOutline() {
  return [
    {
      id: null,
      title: 'Parent task',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent task' }] }],
      children: [
        {
          id: null,
          title: 'Child task',
          status: 'todo',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child task' }] }],
          children: [
            { id: null, title: 'Grandchild task', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Grandchild task' }] }], children: [] }
          ]
        }
      ]
    },
    { id: null, title: 'Sibling top-level', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sibling top-level' }] }], children: [] }
  ]
}

function seedOutlineWithDate() {
  return [
    {
      id: null,
      title: 'Parent task @2025-09-02',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent task @2025-09-02' }] }],
      children: []
    }
  ]
}

function seedTightNestedOutline() {
  return [
    {
      id: null,
      title: 'P',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'P' }] }],
      children: [
        {
          id: null,
          title: 'C',
          status: 'todo',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }],
          children: []
        }
      ]
    }
  ]
}

function seedVerticalAlignmentOutline() {
  return [
    {
      id: null,
      title: 'Alignment sample one',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alignment sample one' }] }],
      children: [
        {
          id: null,
          title: 'Alignment child sample',
          status: 'todo',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alignment child sample' }] }],
          children: []
        }
      ]
    }
  ]
}

test.beforeEach(async ({ app }) => {
  ORIGIN = app.apiUrl;
})

test('reminder toggles sit close to task content for nested and top-level tasks', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedNestedOutline())

  await page.goto('/')
  await expect(page.locator('li.li-node').first()).toBeVisible()

  const nodes = page.locator('li.li-node')
  await expect(nodes).toHaveCount(4)

  async function computeGap(rowLocator) {
    return rowLocator.evaluate(node => {
      const row = node.querySelector(':scope > .li-row')
      if (!row) return null
      const main = row.querySelector(':scope > .li-main')
      if (!main) return null
      const textEl = main.querySelector(':scope > .li-content div[data-node-view-content-react] > p')
      const toggle = main.querySelector(':scope > .li-reminder-area .reminder-toggle')
      if (!textEl || !toggle) return null
      let textRect = textEl.getBoundingClientRect()
      const textNode = textEl.firstChild
      if (textNode && textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
        const trimmed = textNode.textContent.trim()
        if (trimmed) {
          const range = document.createRange()
          const startIndex = textNode.textContent.indexOf(trimmed)
          range.setStart(textNode, Math.max(0, startIndex))
          range.setEnd(textNode, Math.max(0, startIndex) + trimmed.length)
          const rects = range.getClientRects()
          if (rects.length > 0) {
            textRect = rects[0]
          }
          range.detach?.()
        }
      }
      const toggleRect = toggle.getBoundingClientRect()
      return {
        gap: toggleRect.left - textRect.right,
        textRight: textRect.right,
        toggleLeft: toggleRect.left
      }
    })
  }

  const parentGap = await computeGap(nodes.nth(0))
  const childGap = await computeGap(nodes.nth(1))
  const grandChildGap = await computeGap(nodes.nth(2))
  const siblingGap = await computeGap(nodes.nth(3))

  ;[parentGap, childGap, grandChildGap, siblingGap].forEach((result, index) => {
    expect(result, `gap details should exist for row ${index + 1}`).toBeTruthy()
    expect(result?.gap ?? 0, `gap should be within tolerance for row ${index + 1}`).toBeLessThanOrEqual(90)
    expect(result?.gap ?? 0, `gap should not be negative beyond tolerance for row ${index + 1}`).toBeGreaterThanOrEqual(-2)
  })

  const comparePairs = [
    ['parent vs sibling', parentGap, siblingGap],
    ['parent vs child', parentGap, childGap],
    ['child vs grandchild', childGap, grandChildGap]
  ]

  comparePairs.forEach(([label, a, b]) => {
    expect(Math.abs((a?.gap ?? 0) - (b?.gap ?? 0)), `${label} gap difference`).toBeLessThanOrEqual(60)
  })
})

test('reminder toggle respects inline date tokens', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedOutlineWithDate())

  await page.goto('/')
  const row = page.locator('li.li-node > .li-row').first()
  await expect(row).toBeVisible()

  await expect(row.locator('.li-reminder-area')).toHaveClass(/floating/)

  const result = await row.evaluate((node) => {
    const content = node.querySelector(':scope > .li-main .li-content div[data-node-view-content-react] > p')
    const toggle = node.querySelector(':scope > .li-main > .li-reminder-area .reminder-toggle')
    if (!content || !toggle) return null
    const range = document.createRange()
    range.selectNodeContents(content)
    const rects = Array.from(range.getClientRects())
    const anchorRect = rects.length ? rects[rects.length - 1] : content.getBoundingClientRect()
    range.detach?.()
    const toggleRect = toggle.getBoundingClientRect()
    return {
      textRight: anchorRect.right,
      toggleLeft: toggleRect.left,
      gap: toggleRect.left - anchorRect.right,
      inlineGap: getComputedStyle(node.querySelector(':scope > .li-main .li-content')).getPropertyValue('--reminder-inline-gap'),
      offsetStyle: node.querySelector(':scope > .li-main > .li-reminder-area')?.style?.left || null
    }
  })

  expect(result, 'date alignment measurements').toBeTruthy()
  expect(result?.gap ?? 0).toBeGreaterThanOrEqual(-2)
  expect(result?.gap ?? 0).toBeLessThanOrEqual(60)
})

test('reminder toggle aligns vertically with text content', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedVerticalAlignmentOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(2)

  const verticalDiffs = await rows.evaluateAll((rowNodes) => rowNodes.map((row) => {
    const paragraph = row.querySelector(':scope > .li-main > .li-content div[data-node-view-content-react] > p')
    const toggle = row.querySelector(':scope > .li-main > .li-reminder-area .reminder-toggle')
    if (!paragraph || !toggle) return null
    const textRange = document.createRange()
    textRange.selectNodeContents(paragraph)
    const textRect = textRange.getClientRects()[0] || paragraph.getBoundingClientRect()
    textRange.detach?.()
    const toggleRect = toggle.getBoundingClientRect()
    if (!textRect || !toggleRect) return null
    return {
      topDiff: toggleRect.top - textRect.top,
      toggleTop: toggleRect.top,
      textTop: textRect.top
    }
  }))

  verticalDiffs.forEach((entry, index) => {
    expect(entry, `vertical metrics for row ${index + 1}`).toBeTruthy()
    expect(Math.abs(entry?.topDiff ?? 0), `toggle vs text top delta row ${index + 1}`).toBeLessThanOrEqual(2)
  })
})

test('single-line tasks render on one line with reminder controls', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, [
    {
      id: null,
      title: 'Parent single line',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent single line' }] }],
      children: [
        { id: null, title: 'Child single line', status: 'todo', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child single line' }] }], children: [] }
      ]
    }
  ])

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    const rectCount = await rows.nth(index).locator('.li-content div[data-node-view-content-react] > p').first().evaluate((p) => (p ? p.getClientRects().length : 0))
    expect(rectCount, `paragraph line count for row ${index + 1}`).toBe(1)
  }
})

test('li-content boxes do not overlap reminder controls', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedTightNestedOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(2)

  // Wait for reminder positioning to settle
  await expect(rows.first().locator(':scope > .li-main > .li-reminder-area').first()).toHaveClass(/floating/)

  const overlapChecks = await rows.evaluateAll((rowNodes) => {
    return rowNodes.map((row) => {
      const paragraph = row.querySelector(':scope > .li-main > .li-content div[data-node-view-content-react] > p')
      const reminder = row.querySelector(':scope > .li-main > .li-reminder-area')
      if (!paragraph || !reminder) return null
      const paragraphRect = paragraph.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const rects = Array.from(range.getClientRects())
      const maxRight = rects.length > 0 ? rects.reduce((acc, rect) => (rect.right > acc ? rect.right : acc), rects[0].right) : paragraphRect.right
      range.detach?.()
      const reminderRect = reminder.getBoundingClientRect()
      const overlapWidth = Math.min(maxRight, reminderRect.right) - Math.max(paragraphRect.left, reminderRect.left)
      return {
        overlapWidth,
        contentRight: maxRight,
        reminderLeft: reminderRect.left
      }
    })
  })

  overlapChecks.forEach((result, index) => {
    expect(result, `measurement available for row ${index + 1}`).toBeTruthy()
    expect(result?.overlapWidth ?? 0, `horizontal overlap width row ${index + 1}`).toBeLessThanOrEqual(0)
    expect((result?.reminderLeft ?? 0) - (result?.contentRight ?? 0), `content vs reminder separation row ${index + 1}`).toBeGreaterThanOrEqual(-1)
  })
})

test('control buttons stay aligned with li-main even for short nested tasks', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedTightNestedOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(2)

  const alignment = await rows.evaluateAll((rowNodes) => {
    return rowNodes.map((row) => {
      const caret = row.querySelector(':scope > .caret.drag-toggle')
      const status = row.querySelector(':scope > .status-chip')
      const main = row.querySelector(':scope > .li-main')
      if (!caret || !main) return null
      const caretRect = caret.getBoundingClientRect()
      const statusRect = status?.getBoundingClientRect()
      const mainRect = main.getBoundingClientRect()
      return {
        caretOffset: mainRect.top - caretRect.top,
        statusOffset: statusRect ? mainRect.top - statusRect.top : null
      }
    })
  })

  alignment.forEach((result, index) => {
    expect(result, `alignment data for row ${index + 1}`).toBeTruthy()
    expect(Math.abs(result?.caretOffset ?? 0), `caret alignment row ${index + 1}`).toBeLessThanOrEqual(1.5)
    if (result?.statusOffset !== null) {
      expect(Math.abs(result.statusOffset), `status alignment row ${index + 1}`).toBeLessThanOrEqual(1.5)
    }
  })
})
