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
