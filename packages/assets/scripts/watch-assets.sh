#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_WATCH_INTERVAL_SECONDS="${MMO_ASSETS_WATCH_INTERVAL_SECONDS:-2}"

if [[ -z "${MMO_ASSETS_LOCAL_DIR:-}" ]]; then
  echo "MMO_ASSETS_LOCAL_DIR is not set." >&2
  exit 1
fi

if ! [[ "$ASSETS_WATCH_INTERVAL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "MMO_ASSETS_WATCH_INTERVAL_SECONDS must be a positive number." >&2
  exit 1
fi

if ! awk "BEGIN { exit !($ASSETS_WATCH_INTERVAL_SECONDS > 0) }"; then
  echo "MMO_ASSETS_WATCH_INTERVAL_SECONDS must be greater than 0." >&2
  exit 1
fi

echo "Watching assets from $MMO_ASSETS_LOCAL_DIR every ${ASSETS_WATCH_INTERVAL_SECONDS}s (Ctrl+C to stop)..."
"$SCRIPT_DIR/sync-assets-local.sh"

while true; do
  sleep "$ASSETS_WATCH_INTERVAL_SECONDS"
  "$SCRIPT_DIR/sync-assets-local.sh" --silent-no-changes
done
