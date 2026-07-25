#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo 'Compatibility wrapper: use scripts/setup.sh for Graph Platform v3.'
exec "$ROOT/scripts/setup.sh"
