# BelloNote

BelloNote is a daily worklog tool that pairs a TipTap-powered outline editor with reminder scheduling, a calendar-style timeline, and rich history/versioning. The repo ships a Vite + React client and an Express API backed by Postgres that keep outlines, reminders, uploads, and history snapshots in sync.

## Highlights
- Outline editor supports nested tasks with custom statuses, inline reminders, slash commands, image uploads, and local autosave.
- Timeline view renders read-only snapshots per day and reflects updates pushed from autosave and reminder events.
- Reminder center surfaces due items, snoozing, and quick navigation back to the outline.
- History modal records autosave diffs and manual checkpoints, with full snapshot restore support.
- REST API exposes outline CRUD, per-task updates, day rollups, reminder actions, file uploads, and export/import utilities.

## Project Structure
- `client/` – React SPA (Vite) that hosts the editor (`OutlinerView`), Timeline, Reminder center, and History modal.
- `server/` – Express API that persists data in Postgres, manages version history, file storage, and project scoping.
- `start-all.sh` – Convenience script that launches both services via `concurrently` once the API health check passes.
- `FEATURES.md` – Detailed feature brief captured by prior automation runs.
- `tests/`, `playwright.config.js` – Playwright E2E suite covering regression scenarios.

## Prerequisites
- Node.js ≥ 18 (Vite 5 and the React build require modern Node runtimes).
- npm (ships with Node).
- Postgres 13+ running locally or reachable via `DATABASE_URL`.
  - Default connection: `postgres://postgres@127.0.0.1:5432/bello_note`.
  - Override with `DATABASE_URL` or standard `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`.
- Optional: `curl` (used by `start-all.sh` to probe API readiness).

## Initial Setup
1. Install dependencies (node_modules are checked in, but refresh if needed):
   - `npm --prefix server ci`
   - `npm --prefix client ci`
2. Ensure the Postgres database exists (`createdb bello_note`), or export `DATABASE_URL` to point at an existing instance.
3. (Optional) Seed demo content after the first boot: `npm --prefix server run seed`.

## Running in Development
**Option 1 – two services together**
```sh
./start-all.sh
```
- Exposes the API on `http://127.0.0.1:4000`.
- Serves the client on `http://127.0.0.1:5173` with `VITE_API_URL=/` so browser requests proxy to the same host.
- Logs stream into `start-all.log`, `server.log`, and `client.log` in the repo root.

**Option 2 – run separately**
```sh
VITE_API_URL=http://127.0.0.1:4000 npm --prefix client run dev
npm --prefix server start
```
Use this mode if you prefer custom ports or want to attach debuggers independently.

## Testing
Playwright powers regression verification across the full stack.
```sh
npm run test:e2e
```
The script builds the client with `VITE_API_URL=http://127.0.0.1:5231`, so ensure the API is running and reachable at that URL (or adjust the script as needed).

## Environment Reference
- `DATABASE_URL` or `PG*` variables – point to your Postgres instance; required before the API boots.
- `PORT` – set the API port (defaults to `4000`).
- `VITE_API_URL` – API base path used by the client; `start-all.sh` injects `/` to take advantage of Vite's proxy.
- `NODE_ENV` – toggles the `/api/test` utilities and influences reminder polling behavior.

## Helpful Commands
- `npm --prefix client run build` – Generate a production build of the SPA.
- `npm --prefix client run preview` – Serve the static build locally.
- `npm --prefix server run dev` – Start the API with `nodemon` for hot reloads.
- `npm run test:e2e -- --ui` – Use Playwright's inspector for debugging.

## Additional Notes
- Uploads persist in `server/src/uploads/` and are gitignored; the API de-duplicates blobs by SHA and serves them via `/files/:id/:name`.
- The server auto-creates a default "Workspace" project; Playwright runs get an isolated "Playwright E2E" project when the `x-playwright-test` header is present.
- Outline snapshots trigger `worklog:outline-snapshot` events, keeping Timeline and Reminders views in sync without full page refreshes.
- See `FEATURES.md` for deeper UX implementation details captured by automation.

