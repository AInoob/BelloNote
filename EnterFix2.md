The failures fall into two buckets:

* **Client (Enter behavior):** our high‑priority Enter handler prevented ProseMirror’s defaults but didn’t fully handle the “mid‑text” and “empty item” cases consistently (caret + node creation).
* **Server (500s):** routes still reference the old `work_logs` table; with your “single‑table tasks” design, that table is gone, so resets and timeline endpoints crash → cascading test failures.

Below is a **copy‑pasteable fix pack**. Apply all tasks in order.

---

## ✅ Client fixes (Enter key)

### Goal

* **Mid‑text Enter**: split the current list item into two siblings (standard list behavior).
* **Empty item Enter**: insert a **new sibling `<li>`** below and focus it (do **not** fall back to “second paragraph inside the same `<li>`”).
* Always **return `true`** (no default) and **don’t double‑dispatch**.

### 1) Ensure your Enter handler runs first

**File:** `client/src/views/OutlinerView.jsx` (where you construct the Editor)

```diff
+import { Extension } from '@tiptap/core'
+import { handleEnterKey } from './outliner/enterKeyHandler.js' // export this from the handler

+const EnterHighPriority = Extension.create({
+  name: 'enterHighPriority',
+  priority: 1000, // runs before StarterKit keymaps
+  addKeyboardShortcuts() {
+    return {
+      Enter: ({ editor, view, event }) => {
+        const handled = handleEnterKey(editor, view, event)
+        if (handled && event?.preventDefault) event.preventDefault()
+        return !!handled
+      },
+    }
+  },
+})

 // ...
 new Editor({
   // ...
-  extensions: [
-    /* your existing extensions */
-  ],
+  extensions: [
+    EnterHighPriority,      // must be first
+    /* your existing extensions */
+  ],
 })
```

> If you previously wired Enter via `editorProps.handleKeyDown`, keep it, but the **extension must be present** so it wins priority.

---

### 2) Fix `enterKeyHandler.js`: robust empty/mid/end handling + caret placement

**File:** `client/src/views/outliner/enterKeyHandler.js`

Add helpers at the top (or near other imports):

```diff
+import { TextSelection } from '@tiptap/pm/state'
+import { findParentNode } from '@tiptap/core' // TipTap re-exports prosemirror-utils finders in recent versions
+
+function isEffectivelyEmptyListItem(liNode) {
+  if (!liNode || liNode.type?.name !== 'listItem') return false
+  if (liNode.childCount === 0) return true
+  for (let i = 0; i < liNode.childCount; i++) {
+    const child = liNode.child(i)
+    if (child.type?.name !== 'paragraph') return false
+    if (child.content.size > 0) return false
+  }
+  return true
+}
+
+function genTempId() {
+  try { return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'temp-' + Math.random().toString(36).slice(2) }
+  catch { return 'temp-' + Math.random().toString(36).slice(2) }
+}
```

Now replace the **Enter** main branch so all three cases are covered and we **return true** exactly once. This is the important bit:

```diff
-export function handleEnterKey(editor, view, event) {
+export function handleEnterKey(editor, view, event) {
   const { state } = editor
   const { selection, schema, doc } = state
   const { from, empty } = selection
   if (!empty) return false // let default handle multi-range
-  // ... your earlier logic ...
+  // Locate current listItem and its absolute pos
+  const $pos = state.selection.$from
+  const listItemType = schema.nodes.listItem || schema.nodes.list_item
+  const paragraphType = schema.nodes.paragraph
+  const parentLi = findParentNode(node => node.type === listItemType)({ $from: $pos })
+  if (!parentLi) return false
+
+  const listItemPos = parentLi.pos
+  const listItemNode = parentLi.node
+  const atStart = $pos.parentOffset === 0
+  const atEnd = $pos.parentOffset === $pos.parent.content.size
+  const inMiddle = !atStart && !atEnd
+
+  // 1) EMPTY ITEM → create a new sibling <li> below and focus it
+  if (isEffectivelyEmptyListItem(listItemNode)) {
+    event?.preventDefault?.()
+    const tr = state.tr
+    const insertPos = listItemPos + listItemNode.nodeSize
+    const newAttrs = {
+      ...listItemNode.attrs,
+      dataId: genTempId(),   // avoid duplicate ids; UI expects data-id
+      status: '',
+      collapsed: false,
+      archivedSelf: false,
+      tags: Array.isArray(listItemNode.attrs?.tags) ? [] : [],
+    }
+    const newLi = listItemType.createChecked(newAttrs, paragraphType.createChecked())
+    tr.insert(insertPos, newLi)
+    const caret = insertPos + 1 // inside <paragraph>
+    tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView()
+    view.dispatch(tr)
+    return true
+  }
+
+  // 2) MID-TEXT → standard split into two list items
+  if (inMiddle) {
+    event?.preventDefault?.()
+    // Use TipTap command if available; else fallback to your helper
+    const did =
+      (editor?.commands?.splitListItem && editor.commands.splitListItem()) ||
+      (typeof runSplitListItemWithSelection === 'function' && runSplitListItemWithSelection(editor, { splitAtStart: false })) ||
+      false
+    if (did) return true
+    // Fallback: manual insert empty sibling (rare)
+    const tr = state.tr
+    const insertPos = listItemPos + listItemNode.nodeSize
+    const newLi = listItemType.createChecked({ ...listItemNode.attrs, dataId: genTempId(), status: '', collapsed: false }, paragraphType.createChecked())
+    tr.insert(insertPos, newLi)
+    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView()
+    view.dispatch(tr)
+    return true
+  }
+
+  // 3) AT END → create sibling after current (you likely had this path already)
+  if (atEnd) {
+    event?.preventDefault?.()
+    const tr = state.tr
+    const insertPos = listItemPos + listItemNode.nodeSize
+    const newLi = listItemType.createChecked({ ...listItemNode.attrs, dataId: genTempId(), status: '', collapsed: false }, paragraphType.createChecked())
+    tr.insert(insertPos, newLi)
+    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView()
+    view.dispatch(tr)
+    return true
+  }
+
+  // 4) AT START → insert sibling above
+  if (atStart) {
+    event?.preventDefault?.()
+    const tr = state.tr
+    const insertPos = listItemPos // before current
+    const newLi = listItemType.createChecked({ ...listItemNode.attrs, dataId: genTempId(), status: '', collapsed: false }, paragraphType.createChecked())
+    tr.insert(insertPos, newLi)
+    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView()
+    view.dispatch(tr)
+    return true
+  }
+
+  return false
 }
```

**Why this addresses your client test failures**

* **(1) “Enter in middle of task…”** now explicitly splits the item (we intercept default and run split ourselves). Your previous change blocked default but didn’t handle this path → no split → you saw `FirstSecond` unchanged.
* **(2 & 5) “Enter on empty creates new + focuses it”** inserts a **sibling `<li>`** (not another `<p>`), generates a fresh `dataId`, and sets the caret in its paragraph. That removes the “▾⋮⋮” only items with no focus/text.
* We **return `true`** in every handled branch so no downstream keymaps (like `splitBlock` or `liftEmptyBlock`) can undo our insert by turning it into a second paragraph or by lifting out of the list.

> After you confirm all tests pass, remove any debug `console.log` you added in the handler.

---

## ✅ Server fixes (remove `work_logs` dependency, stop 500s)

You moved to a **single‑table `tasks`** design; tests and some routes still reference `work_logs`. We’ll (A) make the reset route tolerant, and (B) provide a compatibility **VIEW** named `work_logs` fed from `tasks.worked_dates` (keeps the “only tables: files, tasks, projects, outline_versions” rule intact; a VIEW isn’t a table).

> These changes will fix:
>
> * **(3)** reminder_alignment “reset server state 500 (work_logs … does not exist)”
> * **(4)** scroll_restore POST /api/outline “socket hang up”
> * **(6)** status_defaults “outline should finish loading” (500s while loading outline/days)

### 3) Make `/api/reset` robust if `work_logs` doesn’t exist

**File:** `server/src/routes/test-reset.ts` (or `routes/test.js` / wherever your reset endpoint lives)

```diff
 export async function resetServerState(req, res) {
   const client = await pool.connect()
   try {
     await client.query('BEGIN')
-    await client.query('DELETE FROM work_logs')
+    // work_logs might not exist anymore (single-table design); ignore if missing or a view
+    try { await client.query('DELETE FROM work_logs') } catch (e) {
+      const msg = String(e?.message || '')
+      if (!/does not exist|view .* does not support|cannot change view/i.test(msg)) throw e
+    }
     await client.query('DELETE FROM files')
     await client.query('DELETE FROM outline_versions')
     await client.query('DELETE FROM tasks')
     await client.query('DELETE FROM projects')
     await client.query('COMMIT')
     res.json({ ok: true })
   } catch (err) {
     await client.query('ROLLBACK')
     res.status(500).json({ error: err.message })
   } finally {
     client.release()
   }
 }
```

### 4) Create a compatibility **VIEW** for `work_logs`

**File:** wherever you run startup migrations (e.g. `server/src/lib/db.ts` in `ensureSchema()`)

```diff
+// Compatibility view: derive work_logs from tasks.worked_dates (jsonb array of 'YYYY-MM-DD' strings)
+await sql`
+  CREATE OR REPLACE VIEW work_logs AS
+  SELECT
+    t.id::uuid            AS task_id,
+    (d.value)::date       AS date
+  FROM tasks t
+  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(t.worked_dates, '[]'::jsonb)) AS d(value);
+`;
```

> Any legacy queries like `SELECT * FROM work_logs WHERE date = $1` keep working.
> **Do not** `DELETE` from this view; the reset route change above already avoids that.

### 5) Stop writing to `work_logs` (if any code still does)

Search for any server writes to `work_logs` (e.g., `INSERT INTO work_logs` or `DELETE FROM work_logs WHERE task_id = ...`) and replace with updates to `tasks.worked_dates` inside the same transaction that updates the task’s content:

```diff
- await db.query('DELETE FROM work_logs WHERE task_id = $1', [taskId])
- for (const d of workedDates) {
-   await db.query('INSERT INTO work_logs (task_id, date) VALUES ($1, $2)', [taskId, d])
- }
+ await db.query(
+   `UPDATE tasks
+      SET worked_dates = $2::jsonb,
+          first_work_date = (SELECT MIN((x)::date) FROM jsonb_array_elements_text($2::jsonb) x),
+          last_work_date  = (SELECT MAX((x)::date) FROM jsonb_array_elements_text($2::jsonb) x)
+    WHERE id = $1`,
+   [taskId, JSON.stringify(workedDates)]
+ )
```

### 6) Make the “days/timeline” route read from `tasks.worked_dates`

If your route still reads the old table, keep it working via the view from step 4. If you prefer to read `tasks` directly, use:

```sql
SELECT t.id, t.title
FROM tasks t
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(COALESCE(t.worked_dates, '[]'::jsonb)) d
  WHERE d.value = $1  -- 'YYYY-MM-DD'
)
AND t.project_id = $2
ORDER BY t.updated_at DESC
LIMIT 500;
```

---

## ✅ Clean up debug logs in tests

When client/server behavior is corrected, remove the temporary logs the tests are currently seeing:

* **`tests/e2e/enter_tab_comprehensive.spec.js`**

    * Remove the `console.log('enter-empty-debug', …)` at ~276 and any throw statements you added for dumping state (the “throw new Error(JSON.stringify(...))” at ~313). The test is failing because it *expects* no debug output.

---

## After applying the patches

1. **Run the two Enter tests only:**

   ```bash
   npx playwright test tests/e2e/enter_tab_comprehensive.spec.js:171 tests/e2e/enter_tab_comprehensive.spec.js:272
   ```

   They should pass (you’ll see a third sibling appear in both scenarios; caret is in the new item).
2. **Run the reminder alignment + scroll restore (server sanity):**

   ```bash
   npx playwright test tests/e2e/reminder_alignment.spec.js:1 tests/e2e/scroll_restore.spec.js:1
   ```

   No 500s; the reset route succeeds.
3. **Run the remaining suites.**

---

### Why these specific changes map to your failures

* **(1)** Mid‑text Enter didn’t create a new item because our high‑priority handler blocked the default split but didn’t implement the split path. We now explicitly perform the split (or manual insert fallback) and return `true`.
* **(2 & 5)** Empty‑item Enter previously inserted a second `<p>` inside the same `<li>` (default `splitBlock`), or inserted a sibling but with a missing `dataId` / wrong caret. We now insert a **new `<li>`**, **assign a fresh id**, and **focus** its paragraph.
* **(3,4,6)** Server crashed because `work_logs` no longer exists. We made reset tolerant and added a **compat view** so old reads continue to work without re‑introducing an extra table.