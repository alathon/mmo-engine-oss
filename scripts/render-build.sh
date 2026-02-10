#!/usr/bin/env bash
set -euo pipefail

echo "=== Render build diagnostics ==="
echo "pwd: $(pwd)"
echo "node: $(node -v)"
echo "pnpm: $(pnpm -v)"
echo "pnpm store dir: $(pnpm config get store-dir)"
echo "pnpm store path: $(pnpm store path)"
echo

echo "=== Ensure turbo is available ==="
if ! command -v turbo >/dev/null 2>&1; then
  pnpm add turbo --global
fi
echo

# Fetch assets if client
if [[ "$1" == "client" ]]; then
    echo "=== Fetch assets ==="
    turbo assets
    echo
fi

echo "=== Install dependencies ==="
pnpm install --no-frozen-lockfile
echo

echo "=== Type-check ==="
turbo check-types
echo

echo "=== Build ==="
echo "Building @mmo/$1..."
pnpm --filter "@mmo/$1..." build
