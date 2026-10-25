#!/usr/bin/env bash
set -euo pipefail

project_dir="${AGENTIC_PROJECT_DIR:-$HOME/agentic-24x7}"
backup_dir="$project_dir/backups"
env_file="$project_dir/.env"
if [[ ! -f "$env_file" ]]; then
  echo "BLOCKED: missing $env_file" >&2
  exit 2
fi

set -a
source "$env_file"
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "BLOCKED: DATABASE_URL is not configured" >&2
  exit 2
fi

install -d -m 0700 "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/agentic-$stamp.dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$target"
sha256sum "$target" > "$target.sha256"
chmod 0600 "$target" "$target.sha256"
echo "PASS backup=$target"
