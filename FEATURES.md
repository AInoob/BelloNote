# Features

## Outline Editor
- Nested worklog editor powered by TipTap with a custom task list item that tracks status, collapse state, tags, inline reminder metadata, and preserves child structure during drag and drop.
- Rich formatting extensions include code blocks with a copy-friendly node view, inline highlights, links without auto-opening, collapsible details blocks, and image uploads that normalize URLs and open a lightbox-style preview on click.
- Slash menu (`/`) offers quick inserts for today’s work-date stamp, custom date picker, archive tag, ad-hoc `#tag`, code block, image upload, and details block commands with type-to-filter search.
- Inline reminder controls live on each task row, providing quick snooze presets, custom date/time scheduling, dismiss/complete/remove actions, and automatic persistence once a server-backed task id exists.
- Clipboard handlers export selection data as plain text, HTML, and a structured JSON slice; paste handlers restore outline slices or apply smart link formatting when URLs are pasted over selected text.

## Filters, Search, and Focus
- Status filter bar exposes per-status toggles, All/Active/Completed presets, and an archived visibility switch, all persisted in localStorage.
- Include/exclude tag filters capture normalized `#tag` entries with removable chips and a single-click clear control, synced to persisted state.
- Search box highlights matches in the current outline while offering a one-click clear; highlight updates reactively as the document changes.
- Focus mode (Cmd/Ctrl+click or programmatic requests) isolates a task subtree, syncs `?focus=<id>` in the URL, shows an exit banner, and remembers collapse sets per focus root.
- Focus router coordinates navigation between Outline and Timeline tabs, forwarding focus requests and clearing them once handled.

## Reminders
- Reminder tokens embedded in outline content are parsed into structured reminder objects, tracked by the `ReminderProvider`, and refreshed on autosave events or a 30-second timer.
- Due reminders surface in a bottom notification bar with snooze presets, custom datetime picker, and inline Mark complete / Dismiss actions that dispatch reminder events and deep-link back to the outline.
- Reminders tab groups tasks by status (due, scheduled, completed) with filter pills, builds read-only outline previews from the latest snapshot, and keeps reminder counts visible on each pill.
- Task-level reminder menus reuse the same scheduling logic, ensuring tasks are saved before emitting reminder actions and clearing validation errors once updates succeed.

## Timeline & Daily Rollups
- Timeline view consumes `/api/day` to group tasks by calendar date, merging work log activity with reminder schedules and auto-scrolling to today on first load.
- Each day renders a read-only `OutlinerView` snapshot with forced expansion, allowing status toggles in place for quick updates that patch `/api/tasks/:id` and refresh both timeline data and the outline snapshot cache.
- Outline snapshots broadcast via `worklog:outline-snapshot` (on autosave) and `worklog:reminder-action` events trigger debounced timeline refreshes for near-real-time feedback.
- Keyboard shortcut (Cmd/Ctrl+S while on the Timeline tab) jumps the user back to the Outline tab with the active task focused.

## History & Checkpoints
- Manual checkpoints open a modal for optional notes, call `/api/history/checkpoint`, and surface a success affordance that deep-links into the History modal.
- Autosave pipeline records outline versions with diff summaries; History modal groups versions by day, shows cause/notes, and streams diff counts plus up to 20 sample titles per change type.
- Inline preview reuses the editor in read-only mode, while a full-screen snapshot viewer supports Older/Newer navigation, restore, and close controls layered above the main modal.
- Restoring any version issues `/api/history/:id/restore`, replaces the current outline, records a new “restore” version, and triggers the supplied `onRestored` callback to refresh the app state.

## Autosave, Persistence, and UX Polish
- Autosave queues write operations, assigns temporary ids when needed, applies server-issued id mappings across the document, migrates saved collapse state, and emits `worklog:outline-snapshot` events for listeners.
- Scroll position, text selection, active tab, status filter, archived toggle, tag filters, and debug flag all persist in localStorage-backed utilities.
- Image clicks open an overlay preview, while a toggleable debug pane streams timestamped diagnostics when enabled from the Top Bar.
- Top Bar reports save state (“Saved”, “Saving…”, “Unsaved changes”), exposes Checkpoint/History toggles, and displays client and server build timestamps once `useBuildInfo` completes.

## Server & Data Model
- Express server on port 4000 exposes JSON routes for outline CRUD, individual task updates, day rollups, history/versioning, image uploads, health checks, static file serving, and Playwright test utilities.
- Outline endpoint sanitizes incoming rich text, strips unsafe data URIs, recomputes tag sets, writes work log dates, and prunes orphaned tasks inside a transaction before recording a new version.
- Timeline (`/api/day`) builds per-date bundles by joining work logs with reminder-bearing tasks, assembling ancestor paths so the Timeline view can regenerate nested structures client-side.
- Versioning layer stores hashed outline snapshots, performs structural diffs for metadata, and replays entire outlines (tasks, work logs, tags) on restore.
- File service stores uploads on disk with SHA-based deduplication, records metadata in SQLite, and serves them through `/files/:id/:name` with optional download disposition.
- Project resolution supports a default workspace plus an isolated “Playwright E2E” project when the test header or data directory conventions are detected.
