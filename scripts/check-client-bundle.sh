#!/usr/bin/env bash
# Fails if a server-only key leaks into the Next.js build output. Run after `npm run build`.
# Usage: scripts/check-client-bundle.sh
#
# Searches what a browser can receive: .next/static, and the prerendered HTML and RSC payloads
# (*.html, *.rsc) under .next/server. Server-only code under .next/server (route handlers, chunks)
# may name these keys, since it reads them from the environment, so it isn't searched.
# Checks key names, and key values too when .env.local has them. Prints key names only,
# never values. Values are passed to grep through a pipe, never argv.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
BUNDLE=".next"
# Server keys (server env or build only). GEMINI_MODEL is public, so it isn't listed.
KEYS=(GEMINI_API_KEY GOOGLE_GEOCODING_KEY ADMIN_PASSCODE CONVEX_DEPLOY_KEY)

if [ ! -d "$BUNDLE" ]; then
  echo "error: $BUNDLE not found. Run npm run build first." >&2
  exit 1
fi

# Whether any pattern on stdin (one per line, fixed strings) is in the client output.
client_has() {
  local patterns
  patterns=$(cat)
  printf '%s\n' "$patterns" | grep -rqF --exclude-dir=cache -f - "$BUNDLE/static" && return 0
  printf '%s\n' "$patterns" | grep -rqF -f - --include='*.html' --include='*.rsc' "$BUNDLE/server" && return 0
  return 1
}

leaks=0
for key in "${KEYS[@]}"; do
  if printf '%s\n' "$key" | client_has; then
    echo "LEAK   $key (name found in the client output of $BUNDLE)"
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
  elif printf '%s\n' "$value" | client_has; then
    echo "LEAK   $key (value found in the client output of $BUNDLE)"
    leaks=1
  else
    echo "ok     $key"
  fi
done

exit $leaks
