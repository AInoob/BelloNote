## At a glance (what’s broken)

1. **Enter key behavior** (3 tests):

   * *Symptoms:* `selectionAdjusted is not defined` page errors, focus not on the newly inserted item (second `<li>` has empty text).
   * *Cause:* A new Enter handler references a missing helper and doesn’t guarantee cursor placement in the fresh list item. Also, new list items are created with **`dataId: null`**, which breaks some downstream logic that expects every li to have an id.

2. **/api/outline POST** (2 tests):

   * *Symptoms:* `socket hang up` on POST; anything that calls resetOutline fails.
   * *Cause:* The route now expects derived columns on the `tasks` row (e.g., tags/worked_dates/reminders/next_remind_at) and/or strong NOT NULLs. When tests seed, they send the raw outline; server doesn’t derive defaults inside the transaction → exception → process aborts or request dropped.

3. **Timeline endpoint** (1 test + the reminder banner test’s console error):

   * *Symptoms:* 500 from timeline: `[timeline] failed to load days …`
   * *Cause:* Route still reads the old `work_logs` table (or equivalent) you removed. Needs to read **`worked_dates`** within `tasks` (single‑table design) and optionally roll up subtree content.

---

# Fix group 1 — Enter key + selection + missing ids

### 1A) Define (or remove) the missing helper and always place the caret in the new item

> **Find:** the Enter handler (usually in something like
> `client/src/views/outliner/keymaps/enterHandlers.(js|ts)` or an extension that overrides `addKeyboardShortcuts()` for the `listItem`).

**Patch (drop‑in):**

```diff
+// utils/selectionAdjusted.js (NEW small helper; import where used)
+import { TextSelection } from 'prosemirror-state'
+export function selectionAdjusted(view) {
+  // Place the cursor at the end of the current selection to stabilize NodeView wrappers
+  // (keeps behavior deterministic after split)
+  const { state } = view
+  const { to } = state.selection
+  const tr = state.tr.setSelection(TextSelection.create(state.doc, to))
+  view.dispatch(tr)
+}

 // In your Enter key handler (inside addKeyboardShortcuts or keymap)
 // Pseudocode – keep your existing guards (editor.isActive('listItem') etc.)
 Enter: ({ editor, view }) => {
   if (!editor.isActive('listItem')) return false

   // First try to split using TipTap's built-in command
   const didSplit = editor.commands.splitListItem('listItem')
   if (!didSplit) return false

-  // selectionAdjusted(...) was previously referenced but not defined
-  selectionAdjusted()
+  // Ensure selection actually lives in the new, empty paragraph
+  try {
+    const { state } = editor.view
+    const { $from } = state.selection
+    // Place caret at start of the current block (which is the fresh paragraph)
+    const tr = state.tr.setSelection(
+      TextSelection.create(state.doc, $from.pos, $from.pos)
+    )
+    editor.view.dispatch(tr)
+    editor.view.focus()
+  } catch (e) {
+    // Best effort; don't throw - keep Enter idempotent
+  }

   return true
 }
```

> If you already have a `selectionAdjusted` utility elsewhere, **import it** instead of redefining it. The critical part is to **not reference an undefined global** and to **focus** the new item.

---

### 1B) Guarantee **every** new list item has a `dataId` immediately

Your own debug log shows:

```json
{"type":"listItem","attrs":{"dataId": null, "status":"", ...}}
```

When `dataId` is null, any code that depends on stable list item identity (e.g., focus tracking, outliner utilities) can break in subtle ways. Assign an id on creation via a lightweight plugin that fills in missing ids after any transaction.

> **Create:** `client/src/views/outliner/plugins/ensureListItemIds.(js|ts)`

```js
import { Plugin } from 'prosemirror-state'

// Fast UUID (ok for client-only ids; server can replace later on save)
function rid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const ensureListItemIds = (schema) => new Plugin({
  appendTransaction(transactions, oldState, newState) {
    // Only if doc actually changed
    if (!transactions.some(tr => tr.docChanged)) return

    let tr = newState.tr
    let changed = false
    const liType = schema.nodes.listItem || schema.nodes.list_item
    if (!liType) return

    newState.doc.descendants((node, pos) => {
      if (node.type !== liType) return
      const did = node.attrs?.dataId || node.attrs?.data_id
      if (!did) {
        const attrs = { ...node.attrs, dataId: rid() }
        tr = tr.setNodeMarkup(pos, liType, attrs, node.marks)
        changed = true
      }
    })
    if (changed) return tr
  }
})
```

> **Register it** when creating the editor (where you set up TipTap extensions):

```diff
 import { Editor } from '@tiptap/react'
+import { ensureListItemIds } from './plugins/ensureListItemIds'

 const editor = new Editor({
   extensions: [
     // ... your existing extensions
   ],
   onCreate() {
     // ...
   }
 })

+// Add the plugin after Editor is constructed
+editor.registerPlugin(ensureListItemIds(editor.schema))
```

This will ensure split/Enter always yields items with ids, which helps focus logic and any DOM dataset hooks.

---

# Fix group 2 — `/api/outline` POST “socket hang up”

The tests seed/reset via:

```js
await request.post(`${API_URL}/api/outline`, { data: { outline }, headers: { 'x-playwright-test': '1' } })
```

**What’s wrong:** after the single‑table change, your POST handler likely writes into `tasks` but **doesn’t** compute the derived columns (`tags`, `worked_dates`, `reminders`, `next_remind_at`, etc.). That now violates NOT NULLs or constraints and crashes the process, yielding a socket hang up.

### 2A) Harden the route (never crash; compute derived columns inline)

> **File:** `server/src/routes/outline.js` (or wherever you handle POST `/api/outline`)

```diff
 router.post('/outline', async (req, res) => {
-  const { outline } = req.body
-  await replaceProjectOutline(outline)  // throws if derived not present
-  res.json({ ok: true })
+  try {
+    const { outline } = req.body || {}
+    if (!Array.isArray(outline)) {
+      return res.status(400).json({ error: 'bad_request', message: 'outline must be an array' })
+    }
+    const projectId = await getOrCreateDefaultProjectId()
+    await db.tx(async (tx) => {
+      // Replace project outline in one transaction
+      await tx.query(`DELETE FROM tasks WHERE project_id = $1`, [projectId])
+      let position = 0
+      const stack = outline.map(node => ({ node, parentId: null }))
+      while (stack.length) {
+        const { node, parentId } = stack.shift()
+        // Ensure every node has an id
+        let id = node.id || node.dataId || uuidv4()
+        // Derive columns from title/content_json (keep self-contained truth)
+        const title = node.title || ''
+        const content_json = node.content || node.content_json || {}
+        const content_hash = hash(title + JSON.stringify(content_json))
+        const { tags, workedDates, reminders, nextRemindAt, pendingCount, firstWorkDate, lastWorkDate } =
+          deriveFromContent(title, content_json)  // implement using your existing parsers
+
+        await tx.query(`
+          INSERT INTO tasks (
+            id, project_id, parent_id, position, title, content_json, content_hash,
+            status, archived, tags, worked_dates, reminders,
+            next_remind_at, reminder_pending_count, first_work_date, last_work_date,
+            created_at, updated_at
+          )
+          VALUES (
+            $1, $2, $3, $4, $5, $6, $7,
+            COALESCE($8, ''), COALESCE($9, false), $10::jsonb, $11::jsonb, $12::jsonb,
+            $13, $14, $15, $16,
+            now(), now()
+          )
+          ON CONFLICT (id) DO UPDATE SET
+            project_id = EXCLUDED.project_id,
+            parent_id  = EXCLUDED.parent_id,
+            position   = EXCLUDED.position,
+            title      = EXCLUDED.title,
+            content_json = EXCLUDED.content_json,
+            content_hash = EXCLUDED.content_hash,
+            status     = EXCLUDED.status,
+            archived   = EXCLUDED.archived,
+            tags       = EXCLUDED.tags,
+            worked_dates = EXCLUDED.worked_dates,
+            reminders  = EXCLUDED.reminders,
+            next_remind_at = EXCLUDED.next_remind_at,
+            reminder_pending_count = EXCLUDED.reminder_pending_count,
+            first_work_date = EXCLUDED.first_work_date,
+            last_work_date  = EXCLUDED.last_work_date,
+            updated_at = now()
+        `, [
+          id, projectId, parentId, position++, title, content_json, content_hash,
+          node.status || '', !!node.archived,
+          JSON.stringify(tags), JSON.stringify(workedDates), JSON.stringify(reminders),
+          nextRemindAt, pendingCount, firstWorkDate, lastWorkDate
+        ])
+
+        // push children (preserve relative order)
+        for (let i = 0; i < (node.children?.length || 0); i++) {
+          stack.push({ node: node.children[i], parentId: id })
+        }
+      }
+    })
+    res.json({ ok: true })
+  } catch (err) {
+    console.error('[outline] save failed', err)
+    res.status(500).json({ error: 'save_failed' })
+  }
 })
```

> **Implement `deriveFromContent(title, content_json)`** by reusing your existing client/server parsers:
>
> * `tags` → lowercased, unique, from both title and content.
> * `workedDates` → all `@YYYY-MM-DD` in title/content.
> * `reminders` → array of tokens with `{ token_id, remind_at, status, timezone, message }`.
> * `nextRemindAt` → MIN(remind_at WHERE status='pending'), else `null`.
> * `pendingCount` → number of pending reminders.
> * `firstWorkDate` / `lastWorkDate` → MIN/MAX(workedDates) (or null).

If you are on **SQLite**, replace the `ON CONFLICT` with `INSERT OR REPLACE` and remove casts.

> **Do not** require the incoming test data to include derived columns—the server computes them.

---

# Fix group 3 — Timeline route now that there’s no `work_logs`

> **File:** `server/src/routes/day.js` (or wherever you serve the timeline days)

Replace any join/reads from old `work_logs` with queries on **`tasks.worked_dates`** and (optionally) subtree rollups via `path`. Two safe approaches:

### 3A) Simple (fast enough for tests; uses just membership)

```diff
 router.get('/day', async (req, res) => {
   try {
-    // old code read from work_logs + tasks join
-    const rows = await db.query(`SELECT ... FROM work_logs ...`)
+    const { date } = req.query   // 'YYYY-MM-DD'
+    if (!date) return res.status(400).json({ error: 'bad_request' })
+    // Tasks that explicitly mention the date
+    const rows = await db.query(`
+      SELECT id, title, content_json, status, parent_id, position
+      FROM tasks
+      WHERE archived = false
+        AND worked_dates @> to_jsonb(ARRAY[$1]::text[])
+      ORDER BY parent_id NULLS FIRST, position, id
+    `, [date])
+
+    // Optional: if your previous UI showed rich content from children of a dated parent,
+    // we can include direct children as well:
+    //   1) fetch all children whose parent is in `rows`  (1 extra query)
+    //   2) attach to the parent's group in JS before responding
+    const byId = new Map(rows.rows.map(r => [r.id, r]))
+    const ids = Array.from(byId.keys())
+    let children = []
+    if (ids.length) {
+      const ph = ids.map((_, i) => `$${i + 2}`).join(',')
+      const q = `SELECT id, title, content_json, status, parent_id, position
+                 FROM tasks WHERE parent_id = ANY($1::uuid[]) ORDER BY position, id`
+      // If on SQLite, run a loop of "WHERE parent_id IN (?)" using parameters
+      const resp = await db.query(q, [ids])
+      children = resp.rows
+    }
+
+    // Shape the payload like before
+    const payload = groupIntoDayPayload(date, rows.rows, children)
+    return res.json(payload)
   } catch (err) {
     console.error('[timeline] failed to load days', err)
     res.status(500).json({ error: 'timeline_failed' })
   }
 })
```

> If your previous implementation *rolled up entire subtrees* under the dated parent, add a `path` column (as designed) and select `WHERE path LIKE parentPath || '%'` to get deep descendants, then render.

---

## Verification guide (exactly the failing tests)

1. **Enter between siblings focuses the new blank item**

   * With the Enter handler fixed and ids guaranteed, run the test.
   * You should see the second item hold `"bello"` as the typed value.

2. **Enter on empty task creates new task and keeps focus / Multiple Enter presses…**

   * The page error `selectionAdjusted is not defined` must disappear.
   * Focus index should be the newly created item each time.

3. **reload restores previous scroll position / timeline tests**

   * `/api/outline` must respond 200 consistently (no “socket hang up”).
   * `timeline_subitems_rich` passes after the `/api/day` route stops referencing removed tables.

4. **reminder banner supports custom schedule…**

   * The console error was `500 (Internal Server Error)` from timeline; fixing `/api/day` typically resolves this test too.
   * If any reminder parsing relies on the old tables, confirm the server now derives `reminders` and `next_remind_at` in the POST handler (Fix 2A).

---

## Troubleshooting tips if anything still flakes

* **grep for the missing helper**
  `rg -n "selectionAdjusted" client/`
  Ensure every reference is either removed or properly imported.

* **Ids still null?**
  Log a sample transaction after creating an item. If your `ensureListItemIds` plugin isn’t running, confirm it’s **registered after** the editor is constructed.

* **/api/outline still fails?**

  * Temporarily log the caught error in Fix 2A—likely a NOT NULL or type cast mismatch.
  * Ensure `deriveFromContent` returns arrays for `tags/workedDates/reminders` even when empty.

* **PG vs SQLite**:

  * For **SQLite**, remove `::jsonb` casts and `ON CONFLICT` clause; use `INSERT OR REPLACE`.
  * For **Postgres**, keep the casts, and ensure your pool doesn’t exhaust on large seeding (tests post ~7KB—fine for default pools).