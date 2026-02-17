#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is not installed or not on PATH." >&2
  exit 1
fi

if ! gh auth status -t >/dev/null 2>&1; then
  echo "gh is installed but not authenticated. Run 'gh auth login'." >&2
  exit 1
fi

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_REPO="${MMO_ASSETS_REPO:-}"
ASSETS_PKG_JSON="$ASSETS_DIR/package.json"

if [[ -n "${MMO_ASSETS_TAG:-}" ]]; then
  release_tag="$MMO_ASSETS_TAG"
else
  if [[ ! -f "$ASSETS_PKG_JSON" ]]; then
    echo "Missing $ASSETS_PKG_JSON to resolve asset version." >&2
    exit 1
  fi
  version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ASSETS_PKG_JSON" | head -n 1)"
  if [[ -z "$version" ]]; then
    echo "Failed to read version from $ASSETS_PKG_JSON." >&2
    exit 1
  fi
  release_tag="v${version}"
fi

mkdir -p "$ASSETS_DIR"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

download_dir="$tmp_dir/download"
mkdir -p "$download_dir"
extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"

assets_tarball="${MMO_ASSETS_TARBALL_NAME:-mmo-assets.tar.gz}"
gh release download "$release_tag" --repo "$ASSETS_REPO" -p "$assets_tarball" -D "$download_dir"

shopt -s nullglob
tarballs=("$download_dir"/*.tar.gz)
shopt -u nullglob

if [[ ${#tarballs[@]} -ne 1 ]]; then
  echo "Expected one tar.gz in $download_dir, found ${#tarballs[@]}." >&2
  exit 1
fi

tar -xz -C "$extract_dir" -f "${tarballs[0]}"

shopt -s nullglob
entries=("$extract_dir"/*)
shopt -u nullglob

if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" ]]; then
  src_dir="${entries[0]}"
else
  src_dir="$extract_dir"
fi

asset_dirs=(icons zones models)
has_structured_assets=false
for asset_dir in "${asset_dirs[@]}"; do
  if [[ -d "$src_dir/$asset_dir" ]]; then
    has_structured_assets=true
    break
  fi
done

if [[ "$has_structured_assets" == true ]]; then
  for asset_dir in "${asset_dirs[@]}"; do
    if [[ -d "$src_dir/$asset_dir" ]]; then
      rm -rf "$ASSETS_DIR/$asset_dir"
      cp -R "$src_dir/$asset_dir" "$ASSETS_DIR/"
    fi
  done
else
  echo "Invalid assets archive layout: expected top-level icons/, zones/, or models/ directories." >&2
  exit 1
fi

echo "Assets fetched into $ASSETS_DIR"
