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
if [[ -n "${CLI_PATH}" && -f "${CLI_PATH}" ]]; then
  exec "${NODE_BIN}" "${CLI_PATH}" "$@"
fi

NPX_BIN="${PLAYWRIGHT_MCP_NPX_BIN:-}"
if [[ -z "${NPX_BIN}" ]]; then
  NPX_BIN="$(command -v npx || true)"
fi

if [[ -n "${NPX_BIN}" && -x "${NPX_BIN}" ]]; then
  if [[ "${EUID:-$(id -u)}" == "0" ]]; then
    for arg in "$@"; do
      if [[ "$arg" == "--no-sandbox" ]]; then
        exec "${NPX_BIN}" -y @playwright/mcp@latest "$@"
      fi
    done
    exec "${NPX_BIN}" -y @playwright/mcp@latest --no-sandbox "$@"
  fi

  exec "${NPX_BIN}" -y @playwright/mcp@latest "$@"
fi

cat >&2 <<'EOF'
Could not locate @playwright/mcp in npm's _npx cache and no usable `npx` was found.
Set PLAYWRIGHT_MCP_CLI to a local cli.js path or install Node/npm so `npx -y @playwright/mcp@latest --help` works.
EOF
exit 1
