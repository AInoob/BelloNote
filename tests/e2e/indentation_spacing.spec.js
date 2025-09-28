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

test.beforeEach(async ({ app }) => {
  ORIGIN = app.apiUrl;
})

test('drag toggles keep a 36px indentation delta between levels', async ({ page, request }) => {
  await ensureBackendReady(request)
  await resetOutline(request, seedNestedOutline())

  await page.goto('/')
  const rows = page.locator('li.li-node > .li-row')
  await expect(rows).toHaveCount(4)

  const caretPositions = await rows.evaluateAll((rowNodes) => rowNodes.map((row, index) => {
    const caret = row.querySelector(':scope > .caret.drag-toggle')
    if (!caret) return null
    const rect = caret.getBoundingClientRect()
    if (!rect) return null
    const rowDepth = (() => {
      let depth = 0
      let el = row.closest('li.li-node')
      while (el) {
        const parentLi = el.parentElement?.closest?.('li.li-node')
        if (!parentLi) break
        depth += 1
        el = parentLi
      }
      return depth
    })()
    return { index, left: rect.left, depth: rowDepth }
  }))

  const validRows = caretPositions.filter(Boolean)
  expect(validRows.length).toBe(4)

  const parents = validRows.find(r => r.depth === 0)
  const children = validRows.filter(r => r.depth === 1)
  const grandchild = validRows.find(r => r.depth === 2)

  expect(parents).toBeTruthy()
  expect(children.length).toBeGreaterThanOrEqual(1)
  expect(grandchild).toBeTruthy()

  const parentToChild = children[0].left - parents.left
  const childToGrandchild = grandchild.left - children[0].left
  const peer = validRows.find(r => r.depth === 0 && r.index !== parents.index)
  expect(peer).toBeTruthy()
  const peerToParent = peer.left - parents.left

  const expectedDelta = 38
  const tolerance = 2
  expect(Math.abs(parentToChild - expectedDelta)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(childToGrandchild - expectedDelta)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(peerToParent)).toBeLessThanOrEqual(tolerance)
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
