#!/usr/bin/env bash
set -euo pipefail

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="${MMO_ASSETS_LOCAL_DIR:-}"
SILENT_NO_CHANGES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --silent-no-changes)
      SILENT_NO_CHANGES=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$LOCAL_DIR" ]]; then
  echo "MMO_ASSETS_LOCAL_DIR is not set." >&2
  exit 1
fi

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "MMO_ASSETS_LOCAL_DIR does not exist or is not a directory: $LOCAL_DIR" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is not installed or not on PATH." >&2
  exit 1
fi

has_asset_layout() {
  local dir="$1"
  [[ -d "$dir/icons" || -d "$dir/zones" || -d "$dir/models" ]]
}

resolve_source_dir() {
  local dir="$1"

  if has_asset_layout "$dir"; then
    echo "$dir"
    return 0
  fi

  shopt -s nullglob
  local entries=("$dir"/*)
  shopt -u nullglob
  if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" ]] && has_asset_layout "${entries[0]}"; then
    echo "${entries[0]}"
    return 0
  fi

  return 1
}

if ! SRC_DIR="$(resolve_source_dir "$LOCAL_DIR")"; then
  echo "Invalid local assets layout: expected top-level icons/, zones/, or models/ directories." >&2
  exit 1
fi

asset_dirs=(icons zones models)
changed=false
declare -a change_lines=()

for asset_dir in "${asset_dirs[@]}"; do
  src_dir="$SRC_DIR/$asset_dir"
  dest_dir="$ASSETS_DIR/$asset_dir"

  if [[ ! -d "$src_dir" ]]; then
    if [[ -d "$dest_dir" ]]; then
      rm -rf "$dest_dir"
      changed=true
      change_lines+=("removed $asset_dir/")
    fi
    continue
  fi

  mkdir -p "$dest_dir"
  rsync_output="$(
    rsync -a --delete \
      --exclude ".git/" \
      --exclude ".git-lfs/" \
      --exclude "*.DS_Store" \
      --out-format="%n" \
      "$src_dir/" \
      "$dest_dir/"
  )"

  if [[ -n "$rsync_output" ]]; then
    changed=true
    while IFS= read -r line; do
      if [[ -n "$line" ]]; then
        change_lines+=("$asset_dir/$line")
      fi
    done <<<"$rsync_output"
  fi
done

if [[ "$changed" == true ]]; then
  echo "Assets synced from $SRC_DIR into $ASSETS_DIR"
  for line in "${change_lines[@]}"; do
    echo " - $line"
  done
elif [[ "$SILENT_NO_CHANGES" == false ]]; then
  echo "Assets already up-to-date from $SRC_DIR into $ASSETS_DIR"
fi
