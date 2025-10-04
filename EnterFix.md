There are two things to fix:

1. **Priority / interception** — make sure your Enter handler runs **before** the default keymaps so the event can’t fall through.
2. **Empty detection & insert** — make the “empty list item” check bullet‑proof and, when it’s empty, **manually insert** a new sibling `<li>` and move the caret there (don’t rely on `splitListItem`, which only handles *non‑empty* textblocks).

Below are copy‑pasteable patches.

---

## ✅ Task 1 — Intercept `Enter` with highest priority so default doesn’t run

> This guarantees your handler runs first; returning `true` will prevent the default behavior that currently adds an extra `<p>` inside the same `<li>`.

**File:** `client/src/views/OutlinerView.jsx` (or wherever you create the `Editor`)

Add a tiny extension that binds `Enter` with **high priority** and calls your existing handler:

```diff
+import { Extension } from '@tiptap/core'
+import { handleEnterKey } from './outliner/enterKeyHandler.js' // export your handler as named export

+const EnterHighPriority = Extension.create({
+  name: 'enterHighPriority',
+  // TipTap loads higher priority first; its keymap runs before StarterKit/hard-break/splitBlock
+  priority: 1000,
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

 // ... inside the `extensions: []` array passed to new Editor({ ... })
-extensions: [/* existing extensions ... */],
+extensions: [
+  EnterHighPriority,         // must be included (priority ensures it runs first)
+  /* existing extensions ... */
+],
```

> If you already wire `Enter` via `editorProps.handleKeyDown`, keep it—but **still** include this extension. Keyboard shortcuts have their own precedence chain; this makes sure your code is first in line.

---

## ✅ Task 2 — Make the “empty item” branch robust, and insert a **new sibling `<li>`**

> The current branch at `client/src/views/outliner/enterKeyHandler.js:108` is not firing (or gets undone). Two fixes: (a) a correct **emptiness** test for list items; (b) a **manual sibling insert** when empty (don’t call `splitListItem` for empty items).

**File:** `client/src/views/outliner/enterKeyHandler.js`

1. **Add a strict empty check** for list items:

```diff
+import { TextSelection } from '@tiptap/pm/state'
+
+// A list item is "effectively empty" if it has only paragraphs and all of them are empty.
+function isEffectivelyEmptyListItem(liNode) {
+  if (!liNode || liNode.type?.name !== 'listItem') return false
+  if (liNode.childCount === 0) return true
+  for (let i = 0; i < liNode.childCount; i += 1) {
+    const child = liNode.child(i)
+    // Any non-paragraph child (e.g., nested list) means "not empty"
+    if (child.type?.name !== 'paragraph') return false
+    if (child.content.size > 0) return false
+  }
+  return true
+}
```

2. **Replace the empty‑item branch** (around your current line ~108) with a **manual insert of a sibling `<li>`** and caret placement. This prevents the “extra paragraph in same `<li>`” symptom:

```diff
-  // EMPTY ITEM branch (current code – not firing or being undone)
-  if (/* current empty check */) {
-    // ... previous logic ...
-  }
+  // EMPTY ITEM: create a new sibling list item below, not another paragraph in the same <li>.
+  if (isEffectivelyEmptyListItem(listItemNode)) {
+    // Stop the default keymaps from running.
+    if (event?.preventDefault) event.preventDefault()
+
+    const { state, view } = editor
+    const { tr, schema } = state
+    const listItemType = schema.nodes.listItem || schema.nodes.list_item
+    const paragraphType = schema.nodes.paragraph
+
+    // Insert position: just after the current <li>
+    const insertPos = listItemPos + listItemNode.nodeSize
+
+    // New <li> with a single empty paragraph (don’t inherit "done" or "collapsed" states)
+    const newAttrs = {
+      ...listItemNode.attrs,
+      status: '',            // ensure status resets (avoid copying 'done')
+      collapsed: false,
+    }
+    const newLi = listItemType.createChecked(newAttrs, paragraphType.createChecked())
+
+    tr.insert(insertPos, newLi)
+
+    // Place caret at start of the new paragraph inside the new <li>
+    const caret = insertPos + 1
+    tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView()
+
+    view.dispatch(tr)
+    // Mark we handled the key; nothing else should run
+    return true
+  }
```

3. **(Keep your non‑empty path)** for “Enter between siblings” (the split case) as you already fixed earlier. That path should still use your `runSplitListItemWithSelection(...)` and then place the caret in the new item (top‑level or child).

---

## ✅ Task 3 — Make sure the non‑empty path still wins before defaults

Right after your non‑empty split logic calculates the caret position for the **new sibling**, make sure you **return `true`** to stop further handlers (or they may still append a paragraph):

```diff
   if (didSplit) {
     // ... your existing adjustment code ...
     // after setting the caret:
-    return true
+    return true  // critical to prevent default splitBlock from firing afterwards
   }
```

If you’re using `.chain().run()` **and** `view.dispatch(tr)` in the same block, do **one or the other**, not both, then `return true`. Double‑dispatch can be interpreted by ProseMirror as “still not handled”, and keymaps will continue.

---

## ✅ Task 4 — Remove troubleshooting logs

Once the behavior is correct, remove your temporary logs:

* In **test**: `tests/e2e/enter_tab_comprehensive.spec.js`
  Delete the `console.log('enter-empty-debug', …)` you added at ~276.

* In **handler**: `client/src/views/outliner/enterKeyHandler.js`
  Remove the `[enter-empty]` `console.log`/`console.warn` lines you added.

---

## Why this fixes your exact failure

* The DOM showing **two `<li>` nodes** but the second gaining **an extra `<p>`** means the default `splitBlock` ran. With **Task 1**, your handler **always** runs first; with **Task 2**, the empty case **never** calls `splitListItem` (which ignores empty blocks); it **inserts a sibling `<li>`** directly and places the caret there; with **Task 3**, nothing else runs afterward.
* Result: after pressing **Enter on an empty second task**, you’ll have **three siblings** (2nd stays empty; a new blank 3rd appears and receives focus). That satisfies the test at `tests/e2e/enter_tab_comprehensive.spec.js:262`.

---

## Quick local validation

1. Start the app and manually reproduce:

    * Make two sibling items: `Item 1`, `[]` (empty).
    * Put the caret in the **empty** second item and press **Enter**.
      ✅ You should now see **three** list items; caret in the brand‑new 3rd.
2. Run just the failing test:

   ```bash
   npx playwright test tests/e2e/enter_tab_comprehensive.spec.js:262
   ```

   ✅ It should pass (and feel free to run the whole file).
3. Verify there are **no** stray debug logs in the console output.

---

### If you still see a paragraph instead of a new `<li>`

Double‑check these two things:

* The `EnterHighPriority` extension is **included** in the editor’s extensions list (and its `priority` set to `1000`). TipTap processes higher priority **first**, so your shortcut runs before default keymaps. ([Tiptap][1])
* Your handler returns `true` on the empty path **and** on the split path, and you aren’t calling both `.run()` **and** `view.dispatch(tr)` for the same keypress.

---