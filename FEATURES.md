# Features

## Outline Editor
- Rich TipTap-based editor renders the daily worklog as an outline of nested tasks with inline rich text, checkmarks, and drag handles.
- Supports unlimited nesting via Tab/Shift+Tab, with consistent indentation spacing and caret behavior for inserting siblings above or below the current item.
- Keyboard-driven creation maintains task defaults: new siblings/children start with an empty status even when the previous row is completed.
- Status chip cycles through `todo → in-progress → done → none`, persisted per task and reflected in `data-status` attributes.
- Command palette (`/`) inserts structured content: code blocks, inline dates (today picker or custom), `@archived / @future / @soon` markers, image uploads, generic `#tag` tokens, details blocks, and reminders.
- Inline slash-tagging automatically normalizes tags, updates `data-tags-self`, and persists to the API for include/exclude filtering.
- Image uploads store files on the server and inject normalized image nodes directly into the outline.
- Copy / paste round-trips preserve the entire outline structure, attachments, and formatting; copy-only exports the highlighted selection.
- Drag-and-drop reorders root items and children, with server persistence to keep ordering consistent across reloads.
- Automatic scroll-state restore returns editors to the previous viewport and caret location after reload.

## Focus, Filters, and Views
- Cmd/Ctrl+click enters Focus Mode for the selected node, isolating its subtree, updating the URL (`?focus=<id>`), displaying an exit banner, and preserving collapse state per focus root.
- Status filter bar exposes pill toggles for individual statuses plus Archived/Future/Soon sections; selections persist via `localStorage` across reloads and view switches.
- `@archived` marks tasks as archived, dims their rows, and can be globally hidden without affecting unarchived parents; hiding archived children keeps parents visible.
- `@future` propagates to descendants and can be hidden or shown with a dedicated filter toggle; `@soon` badges highlight upcoming work and integrate with Soon/Soon toggle tests.
- Hashtag filters (`#tag`) offer separate include/exclude chips, persist across reloads, and immediately hide/show rows by updating `data-tag-include` / `data-tag-exclude`.
- Outline navigation bar switches between Outline, Timeline, Reminders, Checkpoint, and History panels without losing active filters.

## Timeline & Daily Rollups
- Timeline view groups work by calendar day using task dates/work logs, expanding dated parents to show undated subtasks inline.
- Tasks with active reminders appear on the reminder date so upcoming commitments surface alongside past activity.
- Day sections adapt height to the amount of content and preserve `@date` tokens in parent labels for context.
- Soon/Future toggles within Timeline mirror outline filters, allowing Future sections to be hidden, and support persistence across reloads.
- Timeline renders rich content (code blocks, images, nested lists) inside each day's inline preview.
- Dedicated timeline tests ensure filter bar visibility, status-pill dimming, and zero inner scroll (height adjusts automatically).

## Reminders System
- Each outline row exposes a reminder toggle with quick presets (e.g., 30 minutes) and a custom datetime picker.
- Reminder pills surface state (`Reminds`, `Due`, or completion) directly in the outline, updating aria labels for accessibility.
- Reminders navigation reveals a consolidated tab listing scheduled reminders with inline removal controls.
- Due reminders trigger a banner with actionable buttons (Mark complete, Custom schedule, Dismiss) that update both reminder records and task status.
- Server-side reminders API handles creation, updates, dismissal, completion, and state persistence backed by SQLite.

## History, Checkpoints, and Snapshots
- Manual checkpoints capture the entire outline (`Checkpoint` button), storing versions with optional notes via the history API.
- History view lists saved versions, supports selection to preview, and offers Restore actions guarded by confirmation modals layered above snapshot overlays.
- Restoring a version posts back to the server, creating a new version entry while replacing the current outline.
- Daily `/day` snapshots expose work-log history by date, returning paths from root to each task for timeline consumption.

## Data & Persistence Layer
- Express + SQLite backend exposes routes for outline CRUD, reminders, daily snapshots, history/versioning, task utilities, file storage, and static file access.
- Autosave normalizes task IDs, performs optimistic mapping, and stores full ProseMirror node JSON while sanitizing rich text.
- File uploads are stored in `server/src/uploads/` with metadata entries to support secure retrieval via `files` routes.
- Project separation enables a dedicated "Playwright E2E" workspace during tests using `DATA_DIR` swapping.
- Local storage keys (`worklog.filter.*`, `worklog.lastScroll`, collapse caches) retain user preferences between sessions.

## Collaboration-Friendly UX Details
- Status colors stay scoped to the owning row, preventing parent state from bleeding into descendants.
- Copy operations set multiple MIME types (`text/plain`, `text/html`, custom JSON) to ease cross-application pasting.
- Keyboard shortcuts advertise focus mode by toggling a helper class that flips cursor styles while modifiers are held.
- Reminder pills realign alongside text as content grows, ensuring consistent inline layout.
- History/Timeline/Reminders panes maintain Outlook-style navigation without interfering with outline editing state.
