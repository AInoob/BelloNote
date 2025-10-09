# Agents

## Codex Automation
- Captured the Daily Worklog feature set: TipTap outline with custom task nodes, slash commands, inline reminders, autosave snapshots, reminders/timeline tabs, and history + checkpoint flows (see `FEATURES.md`).
- Verified the Vite + React client in `client/` and Express + Postgres-backed API in `server/` ship routes for outline CRUD, day rollups, history/versioning, uploads, files, and health checks.
- Noted `start-all.sh` still drives dependency install (`npm ci` where possible) and launches both services via `concurrently` with shared `VITE_API_URL=/`.
- Ensured runtime folders (`server/data/`, `server/src/uploads/`) remain guarded by `.gitignore` placeholders.
- Regression verification relies on the Playwright e2e suite (`npm run test:e2e`); unit tests are optional.
- React client is organized around an `OutlinerView` TipTap editor that wires in localStorage-backed filters, focus routing between Outline/Timeline/Reminders tabs, reminder scheduling menus, and autosave broadcasting (`worklog:outline-snapshot`) to keep other views fresh.
- Server boot (`server/src/index.js`) hydrates schema via Postgres (`pg` pool) with `ensureSchema`, then exposes REST routes for outline CRUD, per-task updates, day rollups, version history, file uploads, and export/import flows; project scoping auto-creates a default workspace and isolates Playwright runs via the `x-playwright-test` header.
- Timeline and reminder experiences depend on event fan-out: autosave and reminder actions publish events that `TimelineView` consumes to refresh read-only snapshots, while `ReminderProvider` polls due reminders and feeds the notification bar.

## Environment Notes
- `client/` and `server/` already have `node_modules/` present; reinstall as needed to refresh dependencies.
- API listens on port 4000 by default; Vite dev server provides the UI and proxies API calls when started through `start-all.sh`.
- Logs from prior runs are captured in `server.log`, `client.log`, and `start-all.log` at the repo root.
- Backend now expects a reachable Postgres database (defaults to `postgres://postgres@127.0.0.1:5432/bello_note`); override via `DATABASE_URL` or standard `PG*` env vars before launching `start-all.sh`.

## Next Suggested Steps
1. Use `./start-all.sh` to (re)install dependencies and launch both services together.
2. Once running, open the Vite URL printed in the terminal (defaults to `http://localhost:5173`) to access the UI.
3. Seed demo data with `npm run seed` inside `server/` if the workspace starts empty.
