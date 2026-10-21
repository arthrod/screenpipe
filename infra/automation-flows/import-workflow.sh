#!/usr/bin/env bash
# screenpipe — AI that knows everything you've seen, said, or heard
# https://screenpipe.com

# (Re)imports an n8n workflow JSON into the local n8n container, switched off.
# Idempotent: the JSON carries a fixed workflow id, so n8n updates it in place
# (n8n gives it a new versionId on every import). Credentials are referenced by
# id and must already exist in n8n; this script never touches secrets.
#
# Usage: infra/automation-flows/import-workflow.sh [workflow.json]
# Default: the NovaDesk demo workflow. Container: $N8N_CONTAINER or
# automation-flows-n8n-1 (infra/automation-flows/docker-compose.yml).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
file="${1:-$here/workflows/novadesk-support-tickets.json}"
container="${N8N_CONTAINER:-automation-flows-n8n-1}"

id="$(WF="$file" bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.WF, "utf8")).id ?? "")')"
if [ -z "$id" ]; then
  echo "error: $file has no fixed workflow id; import would create a duplicate" >&2
  exit 1
fi

# The CLI import cannot stop a trigger that the running n8n server already
# runs, so refuse to overwrite a workflow that is switched on.
# Listings are captured before grep: `n8n list | grep -q` under pipefail
# fails at random (SIGPIPE, exit 141) and would let this guard pass.
active_ids="$(docker exec "$container" n8n list:workflow --active=true --onlyId 2>/dev/null)"
if grep -qx "$id" <<<"$active_ids"; then
  echo "error: workflow $id is active; switch it off (ScreenPipe or n8n) before re-importing" >&2
  exit 1
fi

target="/tmp/$(basename "$file")"
docker cp "$file" "$container:$target"
docker exec "$container" n8n import:workflow --input="$target"
docker exec -u root "$container" rm -f "$target"

echo "--- n8n list:workflow"
docker exec "$container" n8n list:workflow
inactive_ids="$(docker exec "$container" n8n list:workflow --active=false --onlyId)"
if grep -qx "$id" <<<"$inactive_ids"; then
  echo "ok: $id imported, switched off"
else
  echo "error: $id is not listed as inactive after import" >&2
  exit 1
fi
