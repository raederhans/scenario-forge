# Browser MCP Ops

This folder centralizes non-essential operational helpers for browser inspection.
Runtime evidence defaults to `.runtime/browser/` and generated reports default to `.runtime/reports/generated/`.

## Files
- `inspection-profile.toml`: profile-driven traversal config (routes, sections, gestures, budgets, auto-upgrade).
- `inspection-profile.schema.md`: field definitions and constraints for the profile.
- `start-playwright-mcp-edge.sh`: starts Playwright MCP server (Edge, localhost-only policy) in standalone HTTP mode on `127.0.0.1:8931`.
- `start-playwright-mcp-stdio.sh`: low-level MCP launcher used by the Edge wrapper; keep it for launcher/debug scenarios, not as the normal public entrypoint.
- `run-smoke-browser-inspection.sh`: reuses or starts local dev server, then runs profile-driven browser smoke via Playwright CLI MCP commands on Edge.

## Quick use
```bash
npm install
bash ops/browser-mcp/run-smoke-browser-inspection.sh
```

These scripts are for the repository's own browser inspection and regression flows.
They may use the repo-local `node_modules/playwright/cli.js` when available.
Codex MCP is currently disabled on this machine because the current Codex desktop build treats `@playwright/mcp` resource-list failures as fatal.

## CLI options
```bash
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode auto
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode quick
bash ops/browser-mcp/run-smoke-browser-inspection.sh --mode full
bash ops/browser-mcp/run-smoke-browser-inspection.sh --profile ops/browser-mcp/inspection-profile.toml
bash ops/browser-mcp/run-smoke-browser-inspection.sh --max-runtime-sec 240
```

Options:
- `--profile <path>`: traversal profile path, default `ops/browser-mcp/inspection-profile.toml`
- `--mode quick|full|auto`: run mode, default from profile decision
- `--max-runtime-sec <n>`: runtime override for active phase

## Performance guidance
- Prefer `auto` for routine debugging.
- Use `quick` for fast signal collection.
- Use `full` only when user explicitly asks all sections or quick evidence is insufficient.
