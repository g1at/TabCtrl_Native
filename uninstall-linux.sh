#!/usr/bin/env bash
set -euo pipefail

BROWSER="${1:-chrome}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "$BROWSER" == "--browser" ]]; then
  BROWSER="${2:-chrome}"
fi

MANIFEST_PATH="$(node "$SCRIPT_DIR/generate-manifest.cjs" --browser "$BROWSER" --print-user-path)"
rm -f "$MANIFEST_PATH"
echo "Removed $MANIFEST_PATH"
