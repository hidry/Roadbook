#!/usr/bin/env bash
#
# Stops the local Supabase stack. Pass --reset to also wipe local data.
# Usage: npm run dev:down   (or: npm run dev:down -- --reset)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--reset" ]]; then
  echo "▶ Stopping Supabase and wiping local data…"
  npx --yes supabase stop --no-backup
else
  echo "▶ Stopping Supabase…"
  npx --yes supabase stop
fi
echo "✓ Supabase stopped."
