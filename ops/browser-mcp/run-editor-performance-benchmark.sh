#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$ROOT_DIR"

URL="http://127.0.0.1:18080/?perf_overlay=1"
OUT_PATH="output/perf/editor-performance-benchmark.json"
SCREENSHOT_DIR=".mcp-artifacts/perf"

usage() {
  cat <<USAGE
Usage: bash ops/browser-mcp/run-editor-performance-benchmark.sh [options]

Options:
  --url <url>                Benchmark target URL
  --out <path>               Output JSON path
  --screenshot-dir <path>    Screenshot directory
  -h, --help                 Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --out)
      OUT_PATH="${2:-}"
      shift 2
      ;;
    --screenshot-dir)
      SCREENSHOT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] python3 is required but was not found on PATH." >&2
  exit 1
fi

python3 ops/browser-mcp/editor-performance-benchmark.py \
  --url "$URL" \
  --out "$OUT_PATH" \
  --screenshot-dir "$SCREENSHOT_DIR"
