#!/usr/bin/env bash
# Fails if a server-only key leaks into the Next.js build output. Run after `npm run build`.
# Usage: scripts/check-client-bundle.sh
#
# Searches all of .next/ except the build cache: browsers get .next/static and the
# prerendered HTML/RSC under .next/server, and server keys belong in Convex, so they
# should appear nowhere in the Next build.
# Checks key names, and key values too when .env.local has them. Prints key names only,
# never values. Values are passed to grep through a pipe, never argv.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
BUNDLE=".next"
# Server keys (Convex env or Vercel build only). GEMINI_MODEL is public, so it isn't listed.
KEYS=(GEMINI_API_KEY GROQ_API_KEY GOOGLE_GEOCODING_KEY ADMIN_PASSCODE CONVEX_DEPLOY_KEY)

if [ ! -d "$BUNDLE" ]; then
  echo "error: $BUNDLE not found. Run npm run build first." >&2
  exit 1
fi

leaks=0
for key in "${KEYS[@]}"; do
  if grep -rqF --exclude-dir=cache "$key" "$BUNDLE"; then
    echo "LEAK   $key (name found in $BUNDLE)"
    leaks=1
    continue
  fi
  line=$( { grep -E "^${key}=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1)
  line="${line%$'\r'}"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  if [ -z "$line" ] || [ -z "$value" ]; then
    echo "ok     $key (name only; no value in $ENV_FILE)"
  elif printf '%s\n' "$value" | grep -rqF --exclude-dir=cache -f - "$BUNDLE"; then
    echo "LEAK   $key (value found in $BUNDLE)"
    leaks=1
  else
    echo "ok     $key"
  fi
done

exit $leaks
