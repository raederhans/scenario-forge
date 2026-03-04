#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${PW_MCP_PORT:-8931}"
mkdir -p .mcp-artifacts

exec bash ops/browser-mcp/start-playwright-mcp-stdio.sh \
  --browser msedge \
  --caps vision,devtools \
  --console-level warning \
  --output-dir .mcp-artifacts \
  --allowed-hosts localhost,127.0.0.1 \
  --allowed-origins "http://localhost:*;http://127.0.0.1:*" \
  --host 127.0.0.1 \
  --port "$PORT"
