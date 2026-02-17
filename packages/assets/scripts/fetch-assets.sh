#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESC=$'\033'

filter_ansi() {
  sed -E \
    "s/${ESC}\\[[0-9;]*[[:alpha:]]//g; s/${ESC}\\][^${ESC}]*${ESC}\\\\//g; s/${ESC}\\][^\\a]*\\a//g"
}

if [[ -n "${MMO_ASSETS_LOCAL_DIR:-}" ]]; then
  "$SCRIPT_DIR/sync-assets-local.sh" "$@"
  exit 0
fi

if command -v gh >/dev/null 2>&1; then
  "$SCRIPT_DIR/fetch-assets-gh.sh" "$@" \
    2> >(filter_ansi >&2) \
    | filter_ansi
else
  "$SCRIPT_DIR/fetch-assets-curl.sh" "$@"
fi
