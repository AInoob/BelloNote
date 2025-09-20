# Agents

## Codex Automation
- Imported the Daily Worklog Outliner client and server from `reference/` into the active repo (`client/`, `server/`).
- Preserved helper scripts such as `start-all.sh` for concurrent dev startup.
- Added `.gitignore` guards for runtime data (`server/data/.gitignore`, `server/src/uploads/.gitignore`).
- Ready to install dependencies and run the app via `./start-all.sh`.

## Next Suggested Steps
1. Run `npm ci` (or `npm install`) inside both `client/` and `server/`.
2. Launch `./start-all.sh` to start the API and UI together.
3. Populate tasks via the UI or seed script (`npm run seed` inside `server/`) as needed.
