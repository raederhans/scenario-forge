# preload warning architecture fix 2026-04-22

## Goal
- Remove the `europe_topology.json` unused preload warning from the exact-after-settle regression lane.
- Fix the root cause at the preload architecture layer.

## Scope
- `index.html`
- startup shell contract tests that assert preload behavior
- no unrelated perf or scenario behavior changes

## Constraints
- Only fix the preload warning lane.
- Keep startup bundle preload and scenario index preload intact.
- Prefer removing stale preload architecture over adding test-specific ignores.