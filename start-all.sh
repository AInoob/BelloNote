#!/usr/bin/env bash
set -euo pipefail
# mirror all output to start-all.log as well
exec > >(tee -a start-all.log) 2>&1

export VITE_API_URL="/"
cmd_server='bash -lc "cd server && exec npm start"'
cmd_client='bash -lc "until curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; do sleep 0.5; done; cd client && exec npm run dev -- --host=127.0.0.1 --port=5173 --strictPort"'
export DATA_DIR="${DATA_DIR:-}"
export DATA_FILE="${DATA_FILE:-}"
exec npx concurrently -p "[{name}]" --kill-others-on-fail -n server,client -c green,blue "$cmd_server" "$cmd_client"
