#!/usr/bin/env bash
set -euo pipefail

resolve_cli_path() {
  if [[ -n "${PLAYWRIGHT_MCP_CLI:-}" && -f "${PLAYWRIGHT_MCP_CLI}" ]]; then
    printf '%s\n' "${PLAYWRIGHT_MCP_CLI}"
    return 0
  fi

  python3 - <<'PY'
import glob
import os
import sys

patterns = [
    "/mnt/c/Users/*/AppData/Local/npm-cache/_npx/*/node_modules/@playwright/mcp/cli.js",
]

candidates = []
for pattern in patterns:
    for path in glob.glob(pattern):
        try:
            stat = os.stat(path)
        except OSError:
            continue
        candidates.append((stat.st_mtime, path))

if not candidates:
    sys.exit(1)

candidates.sort(reverse=True)
print(candidates[0][1])
PY
}

NODE_BIN="${PLAYWRIGHT_MCP_NODE_BIN:-/usr/bin/node}"
if [[ ! -x "${NODE_BIN}" ]]; then
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Could not locate a Linux node executable for Playwright MCP." >&2
  exit 1
fi

CLI_PATH="$(resolve_cli_path || true)"
if [[ -z "${CLI_PATH}" || ! -f "${CLI_PATH}" ]]; then
  cat >&2 <<'EOF'
Could not locate @playwright/mcp in npm's _npx cache.
Run `npx -y @playwright/mcp@latest --help` once from WSL, then retry.
EOF
  exit 1
fi

exec "${NODE_BIN}" "${CLI_PATH}" "$@"
