#!/usr/bin/env bash
# Copies the server-side keys from .env.local into the current Convex deployment.
# Usage: scripts/convex-env.sh [--prod]
#   (no flag)  the deployment .env.local points at (dev or local)
#   --prod     the production deployment (needs CONVEX_DEPLOY_KEY or a logged-in CLI)
#
# Values go through a private temp file (`env set --from-file`), never argv: npm prints
# the full command line of every `npx` call, which would leak them into logs.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
KEYS=(GEMINI_API_KEY GEMINI_MODEL GROQ_API_KEY GOOGLE_GEOCODING_KEY ADMIN_PASSCODE)

FLAGS=()
if [ "${1:-}" = "--prod" ]; then
  FLAGS=(--prod)
elif [ -n "${1:-}" ]; then
  echo "usage: scripts/convex-env.sh [--prod]" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found. Copy .env.example to .env.local and fill it in." >&2
  exit 1
fi

tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT

SET=()
for key in "${KEYS[@]}"; do
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)
  line="${line%$'\r'}"
  if [ -z "$line" ]; then
    echo "skip   $key (not in $ENV_FILE)"
    continue
  fi
  value="${line#*=}"
  if [ -z "$value" ] || [ "$value" = '""' ] || [ "$value" = "''" ]; then
    echo "skip   $key (empty)"
    continue
  fi
  printf '%s\n' "$line" >> "$tmp"
  SET+=("$key")
done

if [ ${#SET[@]} -gt 0 ]; then
  npx convex env set ${FLAGS[@]+"${FLAGS[@]}"} --force --from-file "$tmp" >/dev/null
  for key in "${SET[@]}"; do echo "set    $key"; done
fi
