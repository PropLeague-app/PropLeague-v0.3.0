#!/usr/bin/env bash
# Test one deployed edge function against your real Supabase project.
#
# One-time setup per terminal session:
#   export SUPABASE_SERVICE_ROLE_KEY=<paste from dashboard: Project Settings -> API -> service_role>
#
# Usage:
#   scripts/test-function.sh fetch-nfl-scores
#   scripts/test-function.sh fetch-nfl-player-stats '{"week":"3","season":"2025"}'
#   scripts/test-function.sh settle-week '{"week":"3","season":"2025"}'
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a

FN="${1:?usage: scripts/test-function.sh <function-name> ['<json-body>']}"
BODY="${2:-{}}"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY isn't set. Run:" >&2
  echo "  export SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard: Project Settings -> API -> service_role>" >&2
  exit 1
fi

curl -sS -i -X POST "$VITE_SUPABASE_URL/functions/v1/$FN" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY"
echo
