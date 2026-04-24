# App Performance Overhaul Plan

## Current phase
Phase 2 v3.1 slice: metrics contract + hoi4_1939 startup bundle.

## Task list
- [x] Preserve Phase 0/1 completed context.
- [ ] Extend perf baseline summary with startup/chunk/context timing fields.
- [ ] Generate and wire hoi4_1939 startup support + startup bundle assets.
- [ ] Add static/contract coverage for new perf and startup bundle fields.
- [ ] Evaluate UI fanout row-refresh minimum slice.
- [ ] Run targeted verification and review pass.

## Acceptance for this slice
- hoi4_1939 startup bundle files exist for en/zh with .gz sidecars below 5,000,000 bytes.
- hoi4_1939 manifest advertises startup_bundle_url_en/zh, startup_bundle_version, startup_bootstrap_strategy.
- perf summary exposes planned timing/source fields while gate still uses tno_1962 + hoi4_1939.
- Parent thread owns all live test/baseline execution.

## 2026-04-24 Remaining overhaul execution plan

- UI fanout: add water/special row hooks, stable `data-region-id`/`data-region-scope`, and row/full UI refresh metrics.
- contextScenario: keep public pass name, add layer metrics for water/special/relief, cache hit/miss metrics, and signature changed metric.
- interaction hit chain: add candidate/path metrics and merge pending secondary spatial build reasons.
- Hydration: static mapper completed; implementation deferred because current hook registration must stay eager for URL/scenario replay correctness.

Verification target for this slice:
- `node --check js/core/map_renderer.js js/ui/sidebar.js js/ui/sidebar/water_special_region_controller.js js/core/state/config.js js/core/state/renderer_runtime_state.js`
- `python -m unittest tests.test_water_special_region_sidebar_boundary_contract tests.test_sidebar_split_boundary_contract`
- `npm run test:node:scenario-chunk-contracts`
- `npm run test:node:perf-probe-snapshot-behavior`
