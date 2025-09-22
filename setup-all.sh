#!/usr/bin/env bash
set -euo pipefail

# Install dependencies for server and client

echo "[setup-all] Installing server dependencies..."
(
  cd server
  if [ -f package-lock.json ]; then
    npm ci --no-audit --fund=false
  else
    npm install --no-audit --fund=false
  fi
)

echo "[setup-all] Installing client dependencies..."
(
  cd client
  if [ -f package-lock.json ]; then
    npm ci --no-audit --fund=false
  else
    npm install --no-audit --fund=false
  fi
)

echo "[setup-all] Done. You can now run ./start-all.sh"

