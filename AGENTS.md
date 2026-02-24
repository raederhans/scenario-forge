# Project Agent Rules

## Browser Inspection First
When the user asks any of the following (or equivalent intent), use Playwright MCP to inspect running localhost pages before proposing code changes:
- "use browser inspection"
- "open the page yourself"
- "my description is unclear"
- "check both scrolling and navigation"
- "用浏览器检视"
- "你自己打开页面看看"
- "我描述不清楚"
- "滚动和跳转都要检查"

## Mode Decision Rules
Traversal mode for `ops/browser-mcp/run-smoke-browser-inspection.sh`:
1. Default: `auto`.
2. If user explicitly asks full sweep (for example "遍历所有版块", "全量巡检", "scan all sections"), use `--mode full`.
3. If user only asks general inspection, use `--mode quick`.
4. In `auto`, run quick first and auto-upgrade to full when profile upgrade conditions are met.

Configuration source of truth:
- `ops/browser-mcp/inspection-profile.toml`

## Budget Guardrails
Respect profile budgets and stop early when budget is exhausted:
- Quick budget: max sections/screenshots/runtime from `[budgets.quick]`
- Full budget: max sections/screenshots/runtime from `[budgets.full]`

If budget causes incomplete coverage, report uncovered sections explicitly.

## Required Evidence Order
When returning findings, prioritize output in this order:
1. Console errors and warnings.
2. Network failures and 4xx/5xx clues.
3. Key screenshot paths under `.mcp-artifacts/`.
4. Reproduction steps.
5. Minimal patch proposal.

## Scope Constraint
Prefer localhost-only browsing for this project unless the user explicitly asks otherwise.
