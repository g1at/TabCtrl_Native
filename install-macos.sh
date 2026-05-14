#!/usr/bin/env bash
set -euo pipefail

BROWSER="chrome"
EXTENSION_ID=""
USE_MANIFEST_ID=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      BROWSER="${2:-}"
      shift 2
      ;;
    --extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --use-manifest-id)
      USE_MANIFEST_ID=1
      shift
      ;;
    chrome|chromium|edge)
      BROWSER="$1"
      shift
      ;;
    -h|--help)
      echo "Usage: bash native/install-macos.sh [--browser chrome|chromium|edge] [--extension-id <id>] [--use-manifest-id]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/tabctrl-bridge.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install-macos.sh must be run on macOS." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for TabCtrl native bridge." >&2
  exit 1
fi

chmod +x "$HOST_PATH"

ARGS=(--browser "$BROWSER" --host-path "$HOST_PATH" --write-user)
if [[ -n "$EXTENSION_ID" ]]; then
  ARGS+=(--extension-id "$EXTENSION_ID")
elif [[ "$USE_MANIFEST_ID" -eq 1 ]]; then
  ARGS+=(--use-manifest-id)
fi

node "$SCRIPT_DIR/generate-manifest.cjs" "${ARGS[@]}"
