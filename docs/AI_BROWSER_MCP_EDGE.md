# AI Browser MCP (Edge) Usage Guide

## Purpose and scope
This setup lets Codex actively inspect local UI issues in a real browser instead of relying on screenshots only.

Capabilities include:
- open and navigate localhost pages
- scroll and interact with map canvas
- collect console warning/error signals
- collect failed network request signals
- save screenshots and evidence under `.mcp-artifacts/`

## One-time setup and checks
1. Verify MCP is configured:
```bash
codex mcp list
```
Expected: `playwright` appears and is enabled.

2. Verify project config exists:
```bash
cat .codex/config.toml
```
Expected: `--browser msedge`, localhost restrictions, `--output-dir .mcp-artifacts`, and `startup_timeout_sec = 60`.

3. Verify artifacts folder is ignored:
```bash
rg -n "\.mcp-artifacts/" .gitignore
```

## Configuration-driven traversal
The smoke flow is profile-driven, not hardcoded:
- Profile: `ops/browser-mcp/inspection-profile.toml`
- Field reference: `ops/browser-mcp/inspection-profile.schema.md`

Profile controls:
- route list (`[[routes]]`)
- section selectors (`[[sections]]`)
- gestures (`[[gestures]]`)
- quick/full budgets (`[budgets.quick]`, `[budgets.full]`)
- auto-upgrade rules (`[decision]`)

Run with mode/profile overrides:
```bash
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode auto
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode quick
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode full
bash ops/browser-mcp/run-smoke-browser-inspection.sh --profile ops/browser-mcp/inspection-profile.toml --max-runtime-sec 240
```

## Run modes
### A) STDIO mode (default)
Codex starts Playwright MCP directly from `.codex/config.toml`.

Use this first.

### B) Standalone HTTP mode (WSL/headed fallback)
Use when STDIO mode cannot start browser reliably.

Start server:
```bash
bash ops/browser-mcp/start-playwright-mcp-edge.sh
```

Switch client config to:
```toml
[mcp_servers.playwright]
url = "http://localhost:8931/mcp"
```

## Mode decision contract
1. Default is `auto`.
2. `auto`: run quick first, then upgrade to full only when upgrade rules match.
3. Explicit full traversal intent (for example “遍历所有版块” / “full sweep”) should use `--mode full`.
4. General browser inspection intent should use `--mode quick`.

## Fast trigger phrases (copy/paste)
1. `用浏览器检视 localhost 页面，遍历 / 和 /docs/，先给我 console error 和 network failed，再给截图路径。`
2. `你自己打开页面看看，我描述不清楚；请滚动、跳转并给最小修复建议。`
3. `对 localhost 做一次 smoke：主页拖拽+缩放地图，再检查 docs 和 data 页面，输出证据。`
4. `请用 Playwright MCP 主动排查这个 UI 问题，按“console -> network -> 截图 -> 复现步骤”顺序汇报。`
5. `回归验证这三个路由：/、/docs/、/data/ne_10m_admin_1_states_provinces.README.html，并保存截图到 .mcp-artifacts。`

## Smoke runner
```bash
bash ops/browser-mcp/run-smoke-browser-inspection.sh
```

This will:
- reuse existing dev server on `127.0.0.1:8000-8010` when possible
- otherwise start `python3 tools/dev_server.py`
- run browser smoke flow via Playwright CLI MCP commands on Edge
- auto-fallback to a Windows-local `http.server` when Edge cannot reach a WSL-bound localhost endpoint
- write report to `docs/ai-browser-mcp-smoketest.md`

CLI contracts:
- `--profile <path>` default `ops/browser-mcp/inspection-profile.toml`
- `--mode quick|full|auto` default profile decision
- `--max-runtime-sec <n>` optional runtime override

## Cross-project reuse
Global reusable assets are under:
- `/root/.codex/skills/browser-inspect-localhost-mcp-edge/SKILL.md`
- `/root/.codex/skills/browser-inspect-localhost-mcp-edge/references/traversal-rules.md`
- `/root/.codex/skills/browser-inspect-localhost-mcp-edge/assets/mcp-local-edge.template.toml`

In another project:
1. Copy template into project `.codex/config.toml`.
2. Copy `ops/browser-mcp/inspection-profile.toml` and adapt routes/selectors.
3. Use trigger phrase such as “用浏览器检视并按 auto 模式巡检子版块，证据顺序按 console->network->screenshots->repro。”

## Troubleshooting
### Edge startup failure
- Confirm Edge is installed on host OS.
- In WSL environments, prefer Standalone HTTP mode.

### Edge cannot reach local page in WSL
- Root cause is often WSL server binding to `127.0.0.1` while Edge runs on Windows side.
- The smoke runner auto-starts a Windows-local `py -3 -m http.server` fallback on the same port.

### Wrong or busy port
- Dev server already includes built-in fallback from `8000` to `8010`.
- Smoke runner will scan the same range and reuse running instance if found.
- If standalone MCP fails with `EADDRINUSE` on `8931`, stop the existing process on that port or set `PW_MCP_PORT` before starting `start-playwright-mcp-edge.sh`.

### `allowed-origins` blocked request
- Ensure URL starts with `http://localhost:` or `http://127.0.0.1:`.
- Keep host/origin restrictions aligned between config and target URL.

### `.mcp-artifacts` write permission issues
- Ensure repo root is writable.
- Ensure no external process locks screenshot/log files.

### Codex cannot use Playwright in STDIO mode
- Start standalone server and switch config to URL mode.
- Re-run smoke script.
