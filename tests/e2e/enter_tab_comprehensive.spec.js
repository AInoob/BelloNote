/**
 * Comprehensive E2E tests for Enter and Tab key behaviors
 * Covers: multi-level tasks, empty tasks, status persistence, reminder persistence
 */

const { test, expect } = require('./test-base')

const SHORT_TIMEOUT = 2500

async function resetOutline(app, outline = []) {
  await app.resetOutline(outline)
}

function buildInitialOutline() {
  return [
    {
      id: null,
      title: 'Start here',
      status: '',
      dates: [],
      ownWorkedOnDates: [],
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start here' }] }],
      children: []
    }
  ]
}

function buildTask(title) {
  return {
    id: null,
    title,
    status: '',
    dates: [],
    ownWorkedOnDates: [],
    content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }],
    children: []
  }
}

async function openOutline(page) {
  await page.goto('/')
  const editor = page.locator('.tiptap.ProseMirror')
  await expect.poll(async () => {
    const text = await editor.evaluate(el => el.textContent || '')
    return text.includes('Loading…') ? 'loading' : 'ready'
  }).toBe('ready')
  await expect(page.locator('li.li-node').first()).toBeVisible({ timeout: SHORT_TIMEOUT })
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

async function setSelectionToEnd(page, itemIndex) {
  await page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const item = items[idx]
    if (!item) throw new Error(`Item ${idx} not found`)
    const p = item.querySelector('p')
    if (!p) throw new Error(`Paragraph not found in item ${idx}`)
    const range = document.createRange()
    range.selectNodeContents(p)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }, itemIndex)
}

async function clickStatusToggle(page, itemIndex) {
  const items = page.locator('li.li-node')
  const item = items.nth(itemIndex)
  const toggle = item.locator('.status-chip.inline').first()
  await toggle.click()
}

async function getItemStatus(page, itemIndex) {
  return page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const item = items[idx]
    if (!item) return null
    return item.getAttribute('data-status') || ''
  }, itemIndex)
}

async function getItemText(page, itemIndex) {
  return page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const item = items[idx]
    if (!item) return null
    const p = item.querySelector('p')
    return p ? p.textContent.trim() : ''
  }, itemIndex)
}

async function getItemCount(page) {
  return page.locator('li.li-node').count()
}

async function isItemChild(page, itemIndex) {
  return page.evaluate((idx) => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const item = items[idx]
    if (!item) return false
    const parentListItem = item.parentElement?.closest?.('li.li-node')
    return !!parentListItem
  }, itemIndex)
}

test.beforeEach(async ({ app }) => {
  await resetOutline(app, buildInitialOutline())
})

// Test 1: Enter at end of task creates new sibling with empty status
test('Enter at end of task creates new sibling with empty status', async ({ page }) => {
  await openOutline(page)

  // Type into first item
  await typeIntoFirstItem(page, 'Task 1')
  await page.waitForTimeout(100)

  // Set status to done (3 clicks: '' -> todo -> in-progress -> done)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(100)

  // Verify status is done
  const status = await getItemStatus(page, 0)
  expect(status).toBe('done')

  // Press Enter at end
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  // Verify new item created with empty status
  const count = await getItemCount(page)
  expect(count).toBe(2)

  const newStatus = await getItemStatus(page, 1)
  expect(newStatus).toBe('')
})

test('Enter between siblings focuses the new blank item', async ({ page, app }) => {
  await resetOutline(app, [buildTask('task 1'), buildTask('task 2')])
  await openOutline(page)

  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('bello')
  await page.waitForTimeout(50)

  expect(await getItemCount(page)).toBe(3)
  expect(await getItemText(page, 0)).toBe('task 1')
  expect(await getItemText(page, 1)).toBe('bello')
  expect(await getItemText(page, 2)).toBe('task 2')
})

// Test 2: Enter in middle of task creates new empty task (doesn't split text)
test('Enter in middle of task creates new empty task', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'FirstSecond')
  await page.waitForTimeout(100)

  // Set status to todo
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(100)

  // Move cursor to middle (after "First")
  await page.evaluate(() => {
    const p = document.querySelector('li.li-node p')
    const range = document.createRange()
    const textNode = p.firstChild
    range.setStart(textNode, 5) // After "First"
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })

  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(2)

  // First item keeps its text and status
  const text1 = await getItemText(page, 0)
  expect(text1).toBe('FirstSecond')

  const status1 = await getItemStatus(page, 0)
  expect(status1).toBe('todo')

  // New item is empty with no status
  const text2 = await getItemText(page, 1)
  expect(text2).toBe('')

  const status2 = await getItemStatus(page, 1)
  expect(status2).toBe('')
})

// Test 3: Tab indents task to become child of previous sibling
test('Tab indents task to become child of previous sibling', async ({ page }) => {
  await openOutline(page)
  
  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  
  await page.keyboard.type('Child')
  await page.waitForTimeout(100)
  
  // Verify both are root level
  const isChild1 = await isItemChild(page, 1)
  expect(isChild1).toBe(false)
  
  // Press Tab to indent
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  
  // Verify second item is now a child
  const isChild2 = await isItemChild(page, 1)
  expect(isChild2).toBe(true)
})

// Test 4: Shift+Tab outdents child task to sibling level
test('Shift+Tab outdents child task to sibling level', async ({ page }) => {
  await openOutline(page)
  
  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  
  // Verify it's a child
  const isChild1 = await isItemChild(page, 1)
  expect(isChild1).toBe(true)
  
  // Press Shift+Tab to outdent
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)
  
  // Verify it's now a sibling
  const isChild2 = await isItemChild(page, 1)
  expect(isChild2).toBe(false)
})

// Test 5: Enter on empty task creates new task and keeps focus
test('Enter on empty task creates new task and keeps focus', async ({ page }) => {
  await openOutline(page)
  
  await typeIntoFirstItem(page, 'Task 1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  // Don't type anything, just press Enter again
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(3)
  
  const focusedIndex = await page.evaluate(() => {
    const sel = window.getSelection()
    const node = sel?.anchorNode
    const li = node?.parentElement?.closest?.('li.li-node')
    if (!li) return null
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.indexOf(li)
  })
  expect(focusedIndex).toBe(2)
})

// Test 6: Multiple Tab presses create deeply nested structure
test('Multiple Tab presses create deeply nested structure', async ({ page }) => {
  await openOutline(page)
  
  await typeIntoFirstItem(page, 'Level 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Level 2')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  
  await page.keyboard.press('Enter')
  await page.keyboard.type('Level 3')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  
  await page.keyboard.press('Enter')
  await page.keyboard.type('Level 4')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)
  
  const count = await getItemCount(page)
  expect(count).toBe(4)
  
  // Verify nesting levels
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 2, 3])
})

// Test 7: Enter at end of parent with children creates new child
test('Enter at end of parent with children creates new child', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child 1')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Move to parent and press Enter at end
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(3)

  // New item should be a child of parent
  const isChild = await isItemChild(page, 2)
  expect(isChild).toBe(true)

  // New child should be empty
  const text = await getItemText(page, 2)
  expect(text).toBe('')
})

// Test 8: Status persists when indenting with Tab
test('Status persists when indenting with Tab', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.waitForTimeout(100)

  // Set status to in-progress
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(100)

  const statusBefore = await getItemStatus(page, 1)
  expect(statusBefore).toBe('in-progress')

  // Indent with Tab
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Status should persist
  const statusAfter = await getItemStatus(page, 1)
  expect(statusAfter).toBe('in-progress')
})

// Test 9: Status persists when outdenting with Shift+Tab
test('Status persists when outdenting with Shift+Tab', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Set status to done
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(100)

  const statusBefore = await getItemStatus(page, 1)
  expect(statusBefore).toBe('done')

  // Outdent with Shift+Tab
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Status should persist
  const statusAfter = await getItemStatus(page, 1)
  expect(statusAfter).toBe('done')
})

// Test 10: Enter on empty child task creates another empty child
test('Enter on empty child task creates another empty child', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Verify child is indented
  const isChildBefore = await isItemChild(page, 1)
  expect(isChildBefore).toBe(true)

  // Press Enter to create empty child
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(3)

  // New item should also be a child (stays at same level)
  const isChildAfter = await isItemChild(page, 2)
  expect(isChildAfter).toBe(true)

  // New item should be empty
  const text = await getItemText(page, 2)
  expect(text).toBe('')
})

// Test 11: Tab at start of line indents task
test('Tab at start of line indents task', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.waitForTimeout(100)

  // Move cursor to start of second item
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const p = items[1].querySelector('p')
    const range = document.createRange()
    range.setStart(p.firstChild, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })

  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  const isChild = await isItemChild(page, 1)
  expect(isChild).toBe(true)
})

// Test 12: Multiple Enter presses create multiple empty tasks
test('Multiple Enter presses create multiple empty tasks', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Task 1')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(4)

  // All new tasks should be empty
  const text2 = await getItemText(page, 1)
  const text3 = await getItemText(page, 2)
  const text4 = await getItemText(page, 3)
  expect(text2).toBe('')
  expect(text3).toBe('')
  expect(text4).toBe('')
})

// Test 13: Creating child under task with status preserves parent status
test('Creating child under task with status preserves parent status', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await page.waitForTimeout(100)

  // Set parent status to in-progress
  await clickStatusToggle(page, 0)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(100)

  const statusBefore = await getItemStatus(page, 0)
  expect(statusBefore).toBe('in-progress')

  // Create child
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Parent status should be preserved
  const statusAfter = await getItemStatus(page, 0)
  expect(statusAfter).toBe('in-progress')

  // Child should have empty status
  const childStatus = await getItemStatus(page, 1)
  expect(childStatus).toBe('')
})

// Test 14: Tab cannot indent first root-level task
test('Tab cannot indent first root-level task', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'First Task')
  await page.waitForTimeout(100)

  // Try to indent first task
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Should still be root level
  const isChild = await isItemChild(page, 0)
  expect(isChild).toBe(false)
})

// Test 15: Complex multi-level structure with status preservation
test('Complex multi-level structure with status preservation', async ({ page }) => {
  await openOutline(page)

  // Create Level 1
  await typeIntoFirstItem(page, 'Level 1')
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(50)

  // Create Level 2 (child of Level 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Level 2')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(50)

  // Create Level 2b (sibling of Level 2, also child of Level 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Level 2b')
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await page.waitForTimeout(100)

  // Verify structure
  const count = await getItemCount(page)
  expect(count).toBe(3)

  // Verify nesting - both Level 2 and Level 2b are children of Level 1
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 1])

  // Verify statuses
  const status1 = await getItemStatus(page, 0)
  const status2 = await getItemStatus(page, 1)
  const status3 = await getItemStatus(page, 2)
  expect(status1).toBe('todo')
  expect(status2).toBe('in-progress')
  expect(status3).toBe('done')

  // Outdent Level 2b and verify status persists
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  const status3After = await getItemStatus(page, 2)
  expect(status3After).toBe('done')

  // Verify new nesting - Level 2b is now at root level
  const levelsAfter = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsAfter).toEqual([0, 1, 0])
})

// Test 16: Enter in middle of children list creates new sibling child
test('Enter in middle of children list creates new sibling child', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - Task 1
  //   - Sub 1
  //   - Sub 2
  //   - Sub 3
  await typeIntoFirstItem(page, 'Task 1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 1')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Sub 2')
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Sub 3')
  await page.waitForTimeout(100)

  // Verify initial structure
  const levelsInitial = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsInitial).toEqual([0, 1, 1, 1])

  // Verify text BEFORE pressing Enter
  const textBeforeEnter = await getItemText(page, 2)
  expect(textBeforeEnter).toBe('Sub 2')

  // Move cursor to Sub 2 and press Enter
  await setSelectionToEnd(page, 2)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  const count = await getItemCount(page)
  expect(count).toBe(5) // Task 1, Sub 1, Sub 2, new item, Sub 3

  // New item should be a child of Task 1
  const isChild = await isItemChild(page, 3)
  expect(isChild).toBe(true)

  // Verify order: Sub 1, Sub 2, new item, Sub 3
  const text1 = await getItemText(page, 1)
  const text2 = await getItemText(page, 2)
  const text3 = await getItemText(page, 3)
  const text4 = await getItemText(page, 4)
  expect(text1).toBe('Sub 1')
  expect(text2).toBe('Sub 2')
  expect(text3).toBe('')
  expect(text4).toBe('Sub 3')
})

// Test 17: Tab in middle of children list creates grandchild
test('Tab in middle of children list creates grandchild', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - Task 1
  //   - Sub 1
  //   - Sub 2
  //   - Sub 3
  await typeIntoFirstItem(page, 'Task 1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 3')
  await page.waitForTimeout(100)

  // Move cursor to Sub 2 and press Tab
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Verify nesting levels
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })

  // Task 1 (0), Sub 1 (1), Sub 2 (2 - grandchild of Task 1), Sub 3 (1)
  expect(levels).toEqual([0, 1, 2, 1])
})

// Test 18: Shift+Tab in middle of children list outdents to parent level
test('Shift+Tab in middle of children list outdents to parent level', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - Task 1
  //   - Sub 1
  //   - Sub 2
  //   - Sub 3
  await typeIntoFirstItem(page, 'Task 1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 3')
  await page.waitForTimeout(100)

  // Move cursor to Sub 2 and press Shift+Tab
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Verify nesting levels
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })

  // Task 1 (0), Sub 1 (1), Sub 2 (0 - now root level), Sub 3 (1)
  expect(levels).toEqual([0, 1, 0, 1])
})

// Test 19: Backspace at start of child merges with previous sibling
test('Backspace at start of child merges with previous sibling', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - Task 1
  //   - Sub 1
  //   - Sub 2
  await typeIntoFirstItem(page, 'Task 1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub 2')
  await page.waitForTimeout(100)

  const countBefore = await getItemCount(page)
  expect(countBefore).toBe(3)

  // Move to start of Sub 2 and press Backspace
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    const p = items[2].querySelector('p')
    const range = document.createRange()
    range.setStart(p.firstChild, 0)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })

  await page.keyboard.press('Backspace')
  await page.waitForTimeout(100)

  const countAfter = await getItemCount(page)
  expect(countAfter).toBe(2)
})

// Test 20: Shift+Tab on deeply nested item outdents correctly
test('Shift+Tab on deeply nested item outdents correctly', async ({ page }) => {
  await openOutline(page)

  // Create 4-level deep structure
  await typeIntoFirstItem(page, 'L0')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L2')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Verify initial nesting
  const levelsInitial = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsInitial).toEqual([0, 1, 2, 3])

  // Outdent L3 twice
  await setSelectionToEnd(page, 3)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(50)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Verify new nesting
  const levelsFinal = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsFinal).toEqual([0, 1, 2, 1])
})

// Test 21: Enter with status then Tab preserves status
test('Enter with status then Tab preserves status', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await clickStatusToggle(page, 0)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(100)

  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(100)

  const statusBefore = await getItemStatus(page, 1)
  expect(statusBefore).toBe('todo')

  // Indent to make it a child
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Status should persist
  const statusAfter = await getItemStatus(page, 1)
  expect(statusAfter).toBe('todo')

  // Parent status should also persist
  const parentStatus = await getItemStatus(page, 0)
  expect(parentStatus).toBe('in-progress')

  // Verify it's a child
  const isChild = await isItemChild(page, 1)
  expect(isChild).toBe(true)
})

// Test 22: Multiple status changes persist through indentation
test('Multiple status changes persist through indentation', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Task A')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task B')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task C')
  await page.waitForTimeout(100)

  // Set different statuses
  await clickStatusToggle(page, 0) // todo
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 1) // todo
  await clickStatusToggle(page, 1) // in-progress
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 2) // todo
  await clickStatusToggle(page, 2) // in-progress
  await clickStatusToggle(page, 2) // done
  await page.waitForTimeout(100)

  // Indent Task B and C
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Verify all statuses persisted
  const status0 = await getItemStatus(page, 0)
  const status1 = await getItemStatus(page, 1)
  const status2 = await getItemStatus(page, 2)

  expect(status0).toBe('todo')
  expect(status1).toBe('in-progress')
  expect(status2).toBe('done')
})

// Test 23: Creating multiple children preserves parent status
test('Creating multiple children preserves parent status', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await clickStatusToggle(page, 0)
  await clickStatusToggle(page, 0)
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(100)

  const statusBefore = await getItemStatus(page, 0)
  expect(statusBefore).toBe('done')

  // Create first child
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child 1')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)

  // Create second child
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child 2')
  await page.waitForTimeout(50)

  // Create third child
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child 3')
  await page.waitForTimeout(100)

  // Parent status should still be done
  const statusAfter = await getItemStatus(page, 0)
  expect(statusAfter).toBe('done')

  // All children should have empty status
  const child1Status = await getItemStatus(page, 1)
  const child2Status = await getItemStatus(page, 2)
  const child3Status = await getItemStatus(page, 3)
  expect(child1Status).toBe('')
  expect(child2Status).toBe('')
  expect(child3Status).toBe('')
})

// Test 24: Deeply nested structure with Tab operations
test('Deeply nested structure with Tab operations', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - L1
  //   - L2a
  //     - L3a
  //     - L3b (cursor here)
  //     - L3c
  //   - L2b
  await typeIntoFirstItem(page, 'L1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('L2a')
  await page.keyboard.press('Tab')
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3a')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3b')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3c')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L2b')
  await page.waitForTimeout(100)

  // Verify initial structure
  const levelsInitial = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsInitial).toEqual([0, 1, 2, 2, 1, 1])

  // Move to L3b and press Tab to make it L4
  await setSelectionToEnd(page, 3)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  const levelsAfterTab = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsAfterTab).toEqual([0, 1, 2, 3, 1, 1])

  // Press Shift+Tab three times to bring L3b to L0
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(50)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(50)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  const levelsFinal = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsFinal).toEqual([0, 1, 2, 0, 1, 1])
})

// Test 25: Mix Enter, Tab, and status in multi-level structure
test('Mix Enter, Tab, and status in multi-level structure', async ({ page }) => {
  await openOutline(page)

  // Create: Parent (todo) > Child1 (in-progress) > Grandchild (done)
  await typeIntoFirstItem(page, 'Parent')
  await clickStatusToggle(page, 0) // todo
  await page.waitForTimeout(50)

  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child1')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 1) // todo
  await clickStatusToggle(page, 1) // in-progress
  await page.waitForTimeout(50)

  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Grandchild')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 2) // todo
  await clickStatusToggle(page, 2) // in-progress
  await clickStatusToggle(page, 2) // done
  await page.waitForTimeout(100)

  // Verify structure
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 2])

  // Verify statuses
  const status0 = await getItemStatus(page, 0)
  const status1 = await getItemStatus(page, 1)
  const status2 = await getItemStatus(page, 2)
  expect(status0).toBe('todo')
  expect(status1).toBe('in-progress')
  expect(status2).toBe('done')

  // Add sibling to Grandchild with Enter
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Grandchild2')
  await page.waitForTimeout(100)

  // New item should be at same level and have empty status
  const levels2 = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels2).toEqual([0, 1, 2, 2])

  const status3 = await getItemStatus(page, 3)
  expect(status3).toBe('')
})

// Test 26: Enter in middle of multi-level structure with mixed statuses
test('Enter in middle of multi-level structure with mixed statuses', async ({ page }) => {
  await openOutline(page)

  // Create structure:
  // - Root1 (todo)
  //   - Child1 (done)
  //   - Child2 (in-progress)
  //   - Child3 (empty)
  // - Root2 (empty)
  await typeIntoFirstItem(page, 'Root1')
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(50)

  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Child1')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(50)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Child2')
  await clickStatusToggle(page, 2)
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 2)
  await page.waitForTimeout(50)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Child3')
  await page.waitForTimeout(100)

  // Create Root2 as new nested child under Root1
  await setSelectionToEnd(page, 0)
  
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('Root2')
  await page.waitForTimeout(100)

  // Get actual structure
  const texts = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      const p = item.querySelector('p')
      return p ? p.textContent.trim() : ''
    })
  })

  // Find indices of each item
  const root1Idx = texts.indexOf('Root1')
  const child1Idx = texts.indexOf('Child1')
  const child2Idx = texts.indexOf('Child2')
  const child3Idx = texts.indexOf('Child3')
  const root2Idx = texts.indexOf('Root2')

  // Verify statuses BEFORE inserting new item
  const statusListBefore = await page.evaluate(() => Array.from(document.querySelectorAll('li.li-node')).map(li => li.getAttribute('data-status') || ''))
  expect(await getItemStatus(page, root1Idx)).toBe('todo')
  expect(await getItemStatus(page, child1Idx)).toBe('done')
  expect(await getItemStatus(page, child2Idx)).toBe('in-progress')
  expect(await getItemStatus(page, child3Idx)).toBe('')
  expect(await getItemStatus(page, root2Idx)).toBe('')

  // Insert new item after Child2
  await setSelectionToEnd(page, child2Idx)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(50)
  await page.keyboard.type('NewChild')
  await page.waitForTimeout(100)

  // Verify count
  const count = await getItemCount(page)
  expect(count).toBe(6)

  // Get updated structure
  const textsAfter = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      const p = item.querySelector('p')
      return p ? p.textContent.trim() : ''
    })
  })

  // Find updated indices
  const root1IdxAfter = textsAfter.indexOf('Root1')
  const child1IdxAfter = textsAfter.indexOf('Child1')
  const child2IdxAfter = textsAfter.indexOf('Child2')
  const newChildIdx = textsAfter.indexOf('NewChild')
  const child3IdxAfter = textsAfter.indexOf('Child3')
  const root2IdxAfter = textsAfter.indexOf('Root2')

  // Verify all statuses preserved after insert
  expect(await getItemStatus(page, root1IdxAfter)).toBe('todo')
  expect(await getItemStatus(page, child1IdxAfter)).toBe('done')
  expect(await getItemStatus(page, child2IdxAfter)).toBe('in-progress')
  expect(await getItemStatus(page, newChildIdx)).toBe('') // new item
  expect(await getItemStatus(page, child3IdxAfter)).toBe('')
  expect(await getItemStatus(page, root2IdxAfter)).toBe('')

  // Verify structure levels
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })

  // Root1 should be level 0, all descendants including Root2 level 1
  expect(levels[root1IdxAfter]).toBe(0)
  expect(levels[child1IdxAfter]).toBe(1)
  expect(levels[child2IdxAfter]).toBe(1)
  expect(levels[newChildIdx]).toBe(1)
  expect(levels[child3IdxAfter]).toBe(1)
  expect(levels[root2IdxAfter]).toBe(1)
})

// Test 27: Tab and Shift+Tab with status changes in between
test('Tab and Shift+Tab with status changes in between', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Item1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Item2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Item3')
  await page.waitForTimeout(100)

  // Set statuses
  await clickStatusToggle(page, 0) // todo
  await clickStatusToggle(page, 1) // todo
  await clickStatusToggle(page, 1) // in-progress
  await clickStatusToggle(page, 2) // todo
  await clickStatusToggle(page, 2) // in-progress
  await clickStatusToggle(page, 2) // done
  await page.waitForTimeout(100)

  // Indent Item2
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)

  // Verify status preserved
  expect(await getItemStatus(page, 1)).toBe('in-progress')

  // Indent Item3
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(50)

  // Verify status preserved
  expect(await getItemStatus(page, 2)).toBe('done')

  // Verify structure: Item1 with Item2 and Item3 as nested children
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 1])

  // Now outdent Item3
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Status should still be done
  expect(await getItemStatus(page, 2)).toBe('done')

  // Structure should be: Item1 > Item2 with Item3 back at root level
  const levels2 = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels2).toEqual([0, 1, 0])
})

// Test 28: Complex workflow - Create, indent, add status, add siblings, outdent
test('Complex workflow - Create, indent, add status, add siblings, outdent', async ({ page }) => {
  await openOutline(page)

  // Create structure: Project > Task A (todo), Task B (in-progress) > Sub1, Sub2 (done)
  await typeIntoFirstItem(page, 'Project')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task A')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task B')
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub1')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sub2')
  await page.waitForTimeout(100)

  // Verify structure before adding statuses
  const levelsInitial = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsInitial).toEqual([0, 1, 1, 2, 2])

  // Add statuses
  await clickStatusToggle(page, 1) // Task A: todo
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 2) // Task B: todo
  await clickStatusToggle(page, 2) // Task B: in-progress
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 4) // Sub2: todo
  await clickStatusToggle(page, 4) // Sub2: in-progress
  await clickStatusToggle(page, 4) // Sub2: done
  await page.waitForTimeout(100)

  // Verify statuses
  expect(await getItemStatus(page, 0)).toBe('')
  expect(await getItemStatus(page, 1)).toBe('todo')
  expect(await getItemStatus(page, 2)).toBe('in-progress')
  expect(await getItemStatus(page, 3)).toBe('')
  expect(await getItemStatus(page, 4)).toBe('done')

  // Outdent Sub2 to be sibling of Task B
  await setSelectionToEnd(page, 4)
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Verify new structure
  const levels2 = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels2).toEqual([0, 1, 1, 2, 1])

  // All statuses should be preserved
  expect(await getItemStatus(page, 0)).toBe('')
  expect(await getItemStatus(page, 1)).toBe('todo')
  expect(await getItemStatus(page, 2)).toBe('in-progress')
  expect(await getItemStatus(page, 3)).toBe('')
  expect(await getItemStatus(page, 4)).toBe('done')
})

// Test 29: Enter creates sibling, Tab makes it child, status persists
test('Enter creates sibling, Tab makes it child, status persists', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'Parent')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child1')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(100)

  // Create sibling at root level
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Sibling')
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(100)

  // Verify it's at root level
  const levelsBefore = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsBefore).toEqual([0, 0])
  

  // Make it a child of Parent
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  // Verify new structure
  const levelsAfter = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsAfter).toEqual([0, 1])

  // Statuses should be preserved
  expect(await getItemStatus(page, 0)).toBe('in-progress')
  expect(await getItemStatus(page, 1)).toBe('todo')
})

// Test 30: Multi-level with Enter in middle and status changes
test('Multi-level with Enter in middle and status changes', async ({ page }) => {
  await openOutline(page)

  // Create structure: L1 > L2-A > L3-A, L3-B; L2-B
  await typeIntoFirstItem(page, 'L1')
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('L2-A')
  await page.keyboard.press('Tab')
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3-A')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3-B')
  await page.waitForTimeout(100)

  // Verify initial structure: L1 > L2-A > L3-A, L3-B
  const levelsInitial = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levelsInitial).toEqual([0, 1, 2, 2])

  // Add statuses
  await clickStatusToggle(page, 0) // L1: todo
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 1) // L2-A: todo
  await clickStatusToggle(page, 1) // L2-A: in-progress
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 2) // L3-A: todo
  await clickStatusToggle(page, 2) // L3-A: in-progress
  await clickStatusToggle(page, 2) // L3-A: done
  await page.waitForTimeout(50)
  await clickStatusToggle(page, 3) // L3-B: todo
  await page.waitForTimeout(100)

  // Verify statuses before insert
  expect(await getItemStatus(page, 0)).toBe('todo')
  expect(await getItemStatus(page, 1)).toBe('in-progress')
  expect(await getItemStatus(page, 2)).toBe('done')
  expect(await getItemStatus(page, 3)).toBe('todo')

  // Insert new item between L3-A and L3-B
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('L3-NEW')
  await page.waitForTimeout(100)

  // Verify structure after insert
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 2, 2, 2])

  // Verify statuses after insert
  expect(await getItemStatus(page, 0)).toBe('todo')
  expect(await getItemStatus(page, 1)).toBe('in-progress')
  expect(await getItemStatus(page, 2)).toBe('done')
  expect(await getItemStatus(page, 3)).toBe('') // new item
  expect(await getItemStatus(page, 4)).toBe('todo')

  // Add status to new item
  await setSelectionToEnd(page, 3)
  await clickStatusToggle(page, 3)
  await clickStatusToggle(page, 3)
  await page.waitForTimeout(50)

  expect(await getItemStatus(page, 3)).toBe('in-progress')
})

// Test 31: Rapid mixed operations - Enter, Tab, Shift+Tab, status
test('Rapid mixed operations - Enter, Tab, Shift+Tab, status', async ({ page }) => {
  await openOutline(page)

  await typeIntoFirstItem(page, 'A')
  await clickStatusToggle(page, 0)
  await page.waitForTimeout(20)
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('B')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 1)
  await clickStatusToggle(page, 1)
  await page.waitForTimeout(20)
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('C')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await page.waitForTimeout(20)
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('D')
  await page.keyboard.press('Shift+Tab')
  await clickStatusToggle(page, 3)
  await page.waitForTimeout(20)
  await setSelectionToEnd(page, 3)
  await page.keyboard.press('Enter')
  await page.keyboard.type('E')
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(100)

  // Verify structure: A > B > C, D, E (root)
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 2, 1, 0])

  // Verify statuses
  expect(await getItemStatus(page, 0)).toBe('todo')
  expect(await getItemStatus(page, 1)).toBe('in-progress')
  expect(await getItemStatus(page, 2)).toBe('done')
  expect(await getItemStatus(page, 3)).toBe('todo')
  expect(await getItemStatus(page, 4)).toBe('')
})

// Test 32: Enter at different levels preserves hierarchy and status
test('Enter at different levels preserves hierarchy and status', async ({ page }) => {
  await openOutline(page)

  // Create structure with statuses
  await typeIntoFirstItem(page, 'Root')
  await clickStatusToggle(page, 0)
  await clickStatusToggle(page, 0)
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 1)
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Grandchild')
  await page.keyboard.press('Tab')
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await clickStatusToggle(page, 2)
  await page.waitForTimeout(100)

  // Add sibling at each level
  // Level 2: Add sibling to Grandchild
  await setSelectionToEnd(page, 2)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Grandchild2')
  await page.waitForTimeout(50)

  // Level 1: Add sibling to Child
  await setSelectionToEnd(page, 1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child2')
  await page.waitForTimeout(50)

  // Level 0: Add sibling to Root
  await setSelectionToEnd(page, 0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Root2')
  await page.waitForTimeout(100)

  // Verify structure
  const levels = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.li-node'))
    return items.map(item => {
      let level = 0
      let current = item.parentElement?.closest?.('li.li-node')
      while (current) {
        level++
        current = current.parentElement?.closest?.('li.li-node')
      }
      return level
    })
  })
  expect(levels).toEqual([0, 1, 2, 2, 1, 1])

  // Verify original statuses preserved
  expect(await getItemStatus(page, 0)).toBe('in-progress')
  expect(await getItemStatus(page, 1)).toBe('todo')
  expect(await getItemStatus(page, 2)).toBe('done')

  // New items have empty status
  expect(await getItemStatus(page, 3)).toBe('')
  expect(await getItemStatus(page, 4)).toBe('')
  expect(await getItemStatus(page, 5)).toBe('')
})
