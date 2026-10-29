#!/usr/bin/env bash
# Gives this git worktree its own database and bucket in the shared local stack
# (docker-compose.yml), so parallel cards never write to each other's data (§1.1.1).
#
# Every worktree uses the same Postgres and MinIO containers (the compose project is named
# `govtok`), each with a database and bucket named after its card, e.g. govtok_us33 and
# govtok-us33. The script writes DATABASE_URL and S3_* to the worktree's .env.local and applies
# the migrations. Run it once per worktree, from inside the worktree. It is safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"

# The main checkout uses the stack's default database and bucket; never rewrite its .env.local.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  echo "error: run this inside a git worktree, not the main checkout." >&2
  exit 1
fi

touch "$ENV_FILE"

# Drops these keys from .env.local (so they can be re-added, or must not be shared).
drop_vars() {
  local pattern tmp
  pattern="^($(IFS='|'; echo "$*"))="
  tmp=$(mktemp)
  grep -vE "$pattern" "$ENV_FILE" > "$tmp" || true
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Same settings and defaults as docker-compose.yml.
pg_user=${POSTGRES_USER:-govtok}
pg_password=${POSTGRES_PASSWORD:-govtok}
pg_port=${POSTGRES_PORT:-15432}
minio_user=${MINIO_ROOT_USER:-govtok}
minio_password=${MINIO_ROOT_PASSWORD:-govtok-dev-secret}
minio_port=${MINIO_PORT:-19000}
app_key=${S3_ACCESS_KEY:-govtok-app}
app_secret=${S3_SECRET_KEY:-govtok-app-dev-secret}

# The card ID from the branch (US33-run-the-app… → us33), else the worktree folder's name.
name=$(git branch --show-current | grep -oE '^[A-Za-z]+[0-9]+' || basename "$(pwd)")
# Capped so the database name stays under Postgres's 63-character limit.
name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '-' | cut -c1-40 | sed -E 's/^-+|-+$//g')
if [ -z "$name" ]; then
  echo "error: can't name this worktree's database from its branch or folder." >&2
  exit 1
fi
database="govtok_${name//-/_}"
bucket="govtok-${name}"

# 1. Start the shared Postgres and MinIO (a no-op when they are already up), and make sure
#    the app's MinIO user exists (minio-init). Its policy covers govtok-* buckets.
docker compose up -d --wait postgres minio
docker compose run --rm minio-init > /dev/null

# 2. This worktree's database and bucket.
exists=$(docker compose exec -T postgres psql -U "$pg_user" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$database'")
if [ "$exists" != "1" ]; then
  docker compose exec -T postgres createdb -U "$pg_user" "$database"
fi
# Created with the root user; the app's user can't create buckets. Retried: right after MinIO
# boots, mc occasionally fails once.
for attempt in 1 2 3; do
  if docker compose exec -T -e "MC_HOST_local=http://$minio_user:$minio_password@localhost:9000" minio \
    mc mb --ignore-existing "local/$bucket"; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "error: couldn't create bucket $bucket." >&2
    exit 1
  fi
  sleep 2
done

# 3. Point .env.local at them.
drop_vars DATABASE_URL S3_ENDPOINT S3_PUBLIC_URL S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY
cat >> "$ENV_FILE" <<EOF
DATABASE_URL=postgres://$pg_user:$pg_password@127.0.0.1:$pg_port/$database
S3_ENDPOINT=http://127.0.0.1:$minio_port
S3_PUBLIC_URL=http://127.0.0.1:$minio_port
S3_BUCKET=$bucket
S3_ACCESS_KEY=$app_key
S3_SECRET_KEY=$app_secret
EOF

# 4. Apply the migrations (reads DATABASE_URL from .env.local).
npm run db:migrate

echo
echo "Worktree ready: database $database and bucket $bucket in the shared local stack"
