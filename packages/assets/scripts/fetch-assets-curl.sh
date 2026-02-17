#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is not installed or not on PATH." >&2
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is not set." >&2
  exit 1
fi

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_REPO="${MMO_ASSETS_REPO:-}"
ASSETS_URL="${MMO_ASSETS_URL:-}"
ASSETS_TARBALL_NAME="${MMO_ASSETS_TARBALL_NAME:-mmo-assets.tar.gz}"
ASSETS_PKG_JSON="$ASSETS_DIR/package.json"

if [[ -z "$ASSETS_URL" ]]; then
  if [[ -z "${MMO_ASSETS_TAG:-}" ]]; then
    if [[ ! -f "$ASSETS_PKG_JSON" ]]; then
      echo "Missing $ASSETS_PKG_JSON to resolve asset version." >&2
      exit 1
    fi
    version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ASSETS_PKG_JSON" | head -n 1)"
    if [[ -z "$version" ]]; then
      echo "Failed to read version from $ASSETS_PKG_JSON." >&2
      exit 1
    fi
    tag_name="v${version}"
  else
    tag_name="$MMO_ASSETS_TAG"
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is not installed or not on PATH." >&2
    exit 1
  fi

  release_json="$(
    curl -fsSL \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/${ASSETS_REPO}/releases/tags/${tag_name}"
  )"

  asset_id="$(jq -r --arg name "$ASSETS_TARBALL_NAME" '.assets[] | select(.name == $name) | .id' <<<"$release_json" | head -n 1)"
  if [[ -z "$asset_id" || "$asset_id" == "null" ]]; then
    echo "Asset $ASSETS_TARBALL_NAME not found in release." >&2
    exit 1
  fi

  ASSETS_URL="https://api.github.com/repos/${ASSETS_REPO}/releases/assets/${asset_id}"
fi

mkdir -p "$ASSETS_DIR"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"

curl -fsSL \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/octet-stream" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -L "$ASSETS_URL" \
  | tar -xz -C "$extract_dir"

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
