#!/usr/bin/env bash
set -euo pipefail

project_dir="${AGENTIC_PROJECT_DIR:-$HOME/agentic-24x7}"
if [[ ! -f "$project_dir/docker-compose.yml" || ! -f "$project_dir/.env" ]]; then
  echo "BLOCKED: expected docker-compose.yml and .env in $project_dir" >&2
  exit 2
fi

cd "$project_dir"
docker compose config --quiet
docker compose build --pull
docker compose up -d --remove-orphans worker
docker compose ps
