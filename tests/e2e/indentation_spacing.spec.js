const { test, expect } = require('@playwright/test')

test.describe.configure({ mode: 'serial' })

const ORIGIN = process.env.PLAYWRIGHT_ORIGIN || 'http://127.0.0.1:4175'

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
  const response = await request.post(`${ORIGIN}/api/outline`, { data: { outline } })
  expect(response.ok()).toBeTruthy()
}

function seedNestedOutline() {
  return [
    {
      id: null,
      title: 'Parent anchor',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent anchor' }] }],
      children: [
        {
          id: null,
          title: 'Child anchor',
          status: 'todo',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child anchor' }] }],
          children: [
            {
              id: null,
              title: 'Grandchild anchor',
              status: 'todo',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Grandchild anchor' }] }],
              children: []
            }
          ]
        }
      ]
    },
    {
      id: null,
      title: 'Peer anchor',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Peer anchor' }] }],
      children: []
    }
  ]
}

function seedSimpleOutline() {
  return [
    {
      id: null,
      title: 'Task 1',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task 1' }] }],
      children: []
    },
    {
      id: null,
      title: 'Second task without children',
      status: 'todo',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second task without children' }] }],
      children: []
    }
  ]
}

test('drag toggles keep a 36px indentation delta between levels', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedNestedOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(4)

  const caretPositions = await rows.evaluateAll((rowNodes) => rowNodes.map((row) => {
    const caret = row.querySelector(':scope > .caret.drag-toggle')
    if (!caret) return null
    const rect = caret.getBoundingClientRect()
    return rect ? rect.left : null
  }))

  expect(caretPositions.filter((value) => value !== null).length).toBe(4)

  const parentToChild = caretPositions[1] - caretPositions[0]
  const childToGrandchild = caretPositions[2] - caretPositions[1]
  const peerToParent = caretPositions[3] - caretPositions[0]

  expect(Math.abs(parentToChild - 36)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(childToGrandchild - 36)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(peerToParent)).toBeLessThanOrEqual(1.5)
})

test('single-line tasks without children stay on one line', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedSimpleOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(2)

  await expect(rows.first().locator(':scope > .li-main > .li-reminder-area')).toHaveClass(/floating/)

  const rectCounts = await rows.evaluateAll((rowNodes) => {
    return rowNodes.map((row) => {
      const paragraph = row.querySelector(':scope > .li-main > .li-content div[data-node-view-content-react] > p')
      if (!paragraph) return null
      return paragraph.getClientRects().length
    })
  })

  rectCounts.forEach((count, index) => {
    expect(count, `paragraph line count for row ${index + 1}`).toBe(1)
  })
})
