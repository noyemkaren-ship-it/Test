#!/usr/bin/env sh
set -eu

AUDIT_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
AUDIT_PORT=${GP_AUDIT_PORT:-31991}
AUDIT_TMP=$(mktemp -d "${TMPDIR:-/tmp}/graph-platform-audit.XXXXXX")
AUDIT_PID=""

cleanup() {
  if [ -n "$AUDIT_PID" ]; then
    kill "$AUDIT_PID" 2>/dev/null || true
    wait "$AUDIT_PID" 2>/dev/null || true
  fi
  rm -rf "$AUDIT_TMP"
}
trap cleanup EXIT INT TERM

command -v node >/dev/null
command -v npm >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null

printf '%s\n' '[1/8] Reproducible dependencies'
if [ "${GP_AUDIT_SKIP_INSTALL:-0}" != "1" ]; then
  (cd "$AUDIT_ROOT/frontend" && npm ci)
  (cd "$AUDIT_ROOT/backend" && npm ci)
else
  printf '%s\n' 'Skipped by GP_AUDIT_SKIP_INSTALL=1'
fi

printf '%s\n' '[2/8] Dependency security audit'
(cd "$AUDIT_ROOT/frontend" && npm audit --audit-level=moderate)
(cd "$AUDIT_ROOT/backend" && npm audit --audit-level=moderate)

printf '%s\n' '[3/8] Frontend TypeScript'
(cd "$AUDIT_ROOT/frontend" && npm run check)
(cd "$AUDIT_ROOT/frontend" && npm run test:layout)

printf '%s\n' '[4/8] Frontend production build'
(cd "$AUDIT_ROOT/frontend" && npm run build)

printf '%s\n' '[5/8] Backend JavaScript syntax (all source files)'
find "$AUDIT_ROOT/backend/src" -name '*.js' -type f -exec node --check {} \;
BACKEND_COUNT=$(find "$AUDIT_ROOT/backend/src" -name '*.js' -type f | wc -l | tr -d ' ')
printf 'Checked backend files: %s\n' "$BACKEND_COUNT"

printf '%s\n' '[6/8] Python syntax'
PYTHONPYCACHEPREFIX="$AUDIT_TMP/pycache" python3 -m py_compile \
  "$AUDIT_ROOT/offline-ai/server.py" \
  "$AUDIT_ROOT/offline-ai/rnn_model.py" \
  "$AUDIT_ROOT/test/smoke.py"
printf '%s\n' 'Checked Python files: 3'

printf '%s\n' '[7/8] Isolated backend with a temporary SQLite database'
(
  cd "$AUDIT_ROOT/backend"
  SQLITE_PATH="$AUDIT_TMP/audit.sqlite" \
  PORT="$AUDIT_PORT" \
  NODE_ENV=test \
  START_SERVER_IN_TEST=1 \
  OFFLINE_AI_URL=http://127.0.0.1:9 \
  OFFLINE_AI_TIMEOUT_MS=150 \
  node src/index.js
) >"$AUDIT_TMP/backend.log" 2>&1 &
AUDIT_PID=$!

ATTEMPT=0
until curl -fsS "http://127.0.0.1:$AUDIT_PORT/api/health" >/dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 50 ]; then
    printf '%s\n' 'Backend did not become ready. Log:'
    sed -n '1,200p' "$AUDIT_TMP/backend.log"
    exit 1
  fi
  sleep 0.2
done
printf 'Backend ready on temporary port %s\n' "$AUDIT_PORT"

printf '%s\n' '[8/8] API integration smoke'
GP_BASE_URL="http://127.0.0.1:$AUDIT_PORT" \
python3 "$AUDIT_ROOT/test/smoke.py"

printf '%s\n' 'AUDIT RESULT: PASS'
