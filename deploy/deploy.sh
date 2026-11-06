#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env.vm ]]; then
  echo 'Missing .env.vm. Copy .env.vm.example and add the VM secrets.' >&2
  exit 1
fi

compose=(docker compose --env-file .env.vm -f compose.vm.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait db
"${compose[@]}" build app
"${compose[@]}" run --rm --no-deps app node dist/db/migrate.js
"${compose[@]}" up -d --wait app caddy

echo 'Containers are running. Check /health on the configured HTTPS domain and the Caddy logs for certificate issuance.'
