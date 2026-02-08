#!/usr/bin/env bash
set -euo pipefail

echo "=== Render client build diagnostics ==="
echo "pwd: $(pwd)"
echo "node: $(node -v)"
echo "pnpm: $(pnpm -v)"
echo "pnpm store dir: $(pnpm config get store-dir)"
echo "pnpm store path: $(pnpm store path)"
echo

echo "=== Install dependencies ==="
pnpm install --frozen-lockfile
echo

echo "=== Build ==="
pnpm build
echo

echo "=== TypeScript type-check ==="
pnpm -r exec tsc --pretty false --noEmit
echo
