#!/usr/bin/env bash
set -euo pipefail
umask 077

destination="${1:-}"
if [[ "$destination" != gs://* ]]; then
  echo 'Usage: deploy/backup-db.sh gs://YOUR_BUCKET/xaylo' >&2
  exit 1
fi
command -v gcloud >/dev/null || { echo 'gcloud CLI is required on the VM.' >&2; exit 1; }
cd "$(dirname "$0")/.."

archive="$(mktemp /tmp/xaylo-db.XXXXXXXX.dump)"
trap 'rm -f "$archive"' EXIT
docker compose --env-file .env.vm -f compose.vm.yaml exec -T db pg_dump -U xaylo -d xaylo -Fc > "$archive"
test -s "$archive"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
gcloud storage cp "$archive" "${destination%/}/xaylo-${timestamp}.dump"
echo "Database backup uploaded: ${destination%/}/xaylo-${timestamp}.dump"
