# Task

Execute app performance overhaul v3.1 next slice.

## Current owner
Main thread owns implementation and verification. Subagents are static analysis only.

## Metrics + HOI4 startup slice
- [x] Update tools/perf/run_baseline.mjs summary fields.
- [x] Update perf gate static contract.
- [x] Add HOI4 startup support/bundle generation to build_hoi4_scenario.py.
- [x] Generate checked-in hoi4_1939 startup assets from existing checked-in scenario payloads.
- [x] Update hoi4_1939 manifest startup fields.
- [x] Add startup asset contract coverage for hoi4_1939.
- [x] Run targeted tests.

## UI fanout slice
- [x] Inspect current fallback in flushPendingSidebarRefresh/applyAutoFill.
- [x] Apply only a proven row-level refresh change.
- [x] Run existing UI fanout contract if touched.

## 2026-04-24 Remaining overhaul task progress

- [x] Collect static mapper results.
- [x] Implement UI fanout row hooks and metrics.
- [x] Implement contextScenario metrics.
- [x] Implement interaction hit metrics and secondary demand reason merge.
- [ ] Hydration delayed-init implementation, split into a later guarded slice.
- [ ] Full perf gate and e2e validation.

## 2026-04-24 Review remediation task progress

- [x] Fix water row refresh filter/sort consistency.
- [x] Fix contextBreakdown current-frame metric semantics.
- [x] Fix hook result telemetry unwrap.
- [x] Fix secondary demand metric repeated counting.
- [x] Run targeted syntax, contract, and node tests.
