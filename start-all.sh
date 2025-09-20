#!/usr/bin/env bash
set -euo pipefail
export VITE_API_URL="/"
cmd_server='bash -lc "
  set -e;
  cd server;
  if [ -f package-lock.json ]; then npm ci --no-audit --fund=false || npm install --no-audit --fund=false; else npm install --no-audit --fund=false; fi;
  npm start
"'
cmd_client='bash -lc "
  set -e;
  cd client;
  if [ -f package-lock.json ]; then npm ci --no-audit --fund=false || npm install --no-audit --fund=false; else npm install --no-audit --fund=false; fi;
  npm run dev
"'
export DATA_DIR="${DATA_DIR:-}"
export DATA_FILE="${DATA_FILE:-}"
exec npx concurrently --raw --kill-others-on-fail -n server,client -c green,blue "$cmd_server" "$cmd_client"
