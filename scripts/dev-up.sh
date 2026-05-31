#!/usr/bin/env bash
#
# Repeatable local backend bring-up. Starts the local Supabase stack (Docker) and
# (re)generates .env with the freshly minted local URL + keys, while keeping the
# R2/map placeholders from .env.example. Idempotent: safe to run repeatedly.
#
# Usage: npm run dev:up   (then: npm run rls:test  |  npx expo start)
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE=(npx --yes supabase)

echo "▶ Starting local Supabase (Docker)…"
"${SUPABASE[@]}" start

echo "▶ Reading local credentials…"
ENVOUT="$("${SUPABASE[@]}" status -o env)"
get() { printf '%s\n' "$ENVOUT" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }

API_URL="$(get API_URL)"
ANON="$(get ANON_KEY)"
SERVICE="$(get SERVICE_ROLE_KEY)"

if [[ -z "$API_URL" || -z "$ANON" || -z "$SERVICE" ]]; then
  echo "✗ Could not read Supabase status. Is Docker running?" >&2
  exit 1
fi

echo "▶ Writing .env (Supabase values; R2/map stay as placeholders)…"
SUPABASE_KEYS='^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)='
# Start from the template (minus the keys we own), then append fresh values.
grep -vE "$SUPABASE_KEYS" .env.example > .env
cat >> .env <<EOF

# ── injected by scripts/dev-up.sh (local Supabase) ──
EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_URL=$API_URL
SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
EOF

echo "✓ Supabase up. Studio: http://127.0.0.1:54323"
echo "  Next: npm run rls:test   |   npx expo start"
