#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo 'Node.js 20+ is required'; exit 1; }
command -v npm >/dev/null || { echo 'npm is required'; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3.10+ is required'; exit 1; }

echo '[1/3] Backend dependencies'
(cd "$ROOT/backend" && npm ci)

echo '[2/3] Frontend dependencies'
(cd "$ROOT/frontend" && npm ci)

echo '[3/3] Environment templates'
[ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
[ -f "$ROOT/offline-ai/.env" ] || cp "$ROOT/offline-ai/.env.example" "$ROOT/offline-ai/.env"

echo 'Ready. Start backend, offline-ai/server.py and frontend as described in README.md.'
