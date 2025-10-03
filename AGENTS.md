# Agents

## Codex Automation
- Captured the Daily Worklog feature set: TipTap outline with custom task nodes, slash commands, inline reminders, autosave snapshots, reminders/timeline tabs, and history + checkpoint flows (see `FEATURES.md`).
- Verified the Vite + React client in `client/` and Express + SQLite API in `server/` ship routes for outline CRUD, day rollups, history/versioning, uploads, files, and health checks.
- Noted `start-all.sh` still drives dependency install (`npm ci` where possible) and launches both services via `concurrently` with shared `VITE_API_URL=/`.
- Ensured runtime folders (`server/data/`, `server/src/uploads/`) remain guarded by `.gitignore` placeholders.
- Regression verification relies on the Playwright e2e suite (`npm run test:e2e`); unit tests are optional.

## Environment Notes
- `client/` and `server/` already have `node_modules/` present; reinstall as needed to refresh dependencies.
- API listens on port 4000 by default; Vite dev server provides the UI and proxies API calls when started through `start-all.sh`.
- Logs from prior runs are captured in `server.log`, `client.log`, and `start-all.log` at the repo root.

## Next Suggested Steps
1. Use `./start-all.sh` to (re)install dependencies and launch both services together.
2. Once running, open the Vite URL printed in the terminal (defaults to `http://localhost:5173`) to access the UI.
3. Seed demo data with `npm run seed` inside `server/` if the workspace starts empty.
