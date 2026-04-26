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


## 2026-04-24 Direct interaction closeout task progress

- [x] Add direct interaction duration metrics.
- [x] Add hover metric sampling rule.
- [x] Defer mousemove hover overlay render by one RAF.
- [x] Keep click/dblclick hit path semantics unchanged.
- [x] Add static contract coverage for hover RAF, metric names, secondary demand, and eager hooks.
- [x] Run targeted validation and perf gate.

## 2026-04-25 Map interaction speed task progress

- [x] Collect static maps from subagents.
- [x] Add execution plan/context notes.
- [x] Implement benchmark/perf probe schema v3.1 fields.
- [x] Implement main-pass interaction composite cache.
- [x] Implement hover-only strict hit shortcut.
- [x] Implement post-ready pending/retry diagnostics.
- [x] Extend existing contract tests.
- [x] Run parent-owned targeted verification.
- [ ] Stabilize `test:e2e:dev:scenario-chunk-runtime` in a separate follow-up if it keeps alternating failure points.

## 2026-04-25 Map interaction speed remediation progress

- [x] Fix perf gate schema hard contract.
- [x] Split startup post-ready infra metrics from interaction recovery benchmark metrics.
- [x] Reject continuity frames across topologyRevision changes.
- [x] Preserve explicit focusCountryOverride priority for zoom-end chunk detail selection.
- [x] Re-run scenario chunk runtime E2E after remediation.

## 2026-04-25 Final verification checklist

- [x] node syntax checks for changed JS/MJS.
- [x] Python py_compile for changed Python files.
- [x] node scenario chunk contract tests.
- [x] perf probe snapshot behavior tests.
- [x] Python perf gate and scenario chunk refresh contract tests.
- [x] TNO ready-state E2E.
- [x] scenario chunk runtime E2E.
- [x] interaction funnel E2E.
- [x] static code review findings remediated.

## 2026-04-26 interaction-continuity-and-promotion-slicing task progress
- [x] Record approved execution plan in active docs.
- [ ] Implement fast-frame eligibility, firstVisibleFramePainted, and interactionComposite identity.
- [ ] Implement async single-flight chunk promotion commit and serializable runtime status.
- [ ] Remove hit-canvas spatial-unavailable all-feature fallback.
- [ ] Update existing node/Python contract tests.
- [ ] Run syntax, node, Python, E2E, and perf verification in serial.
- [ ] Run review/bug-check/first-principles pass and update lessons learned if needed.



## 2026-04-26 03:22 UTC verification evidence
- 
ode --check affected JS files: pass.
- python -m py_compile affected Python contracts: pass.
- 
pm run test:node:renderer-runtime-state-behavior: pass.
- 
pm run test:node:scenario-runtime-state-behavior: pass.
- 
pm run test:node:scenario-chunk-contracts: pass.
- python -m unittest tests.test_scenario_chunk_refresh_contracts tests.test_map_renderer_spatial_index_runtime_orchestration_contract tests.test_scenario_runtime_state_boundary_contract tests.test_scenario_rollback_boundary_contract tests.test_perf_gate_contract -q: pass.
- 
pm run test:e2e:dev:scenario-chunk-runtime: pass after fixing stale refresh race.
- 
pm run test:e2e:dev:tno-ready-state: pass.
- 
pm run test:e2e:interaction-funnel: pass.
- 
pm run perf:baseline: pass and rewrote docs/perf/baseline_2026-04-20.*.
- 
pm run perf:gate: pass.
- 
pm run test: unavailable; package has no 	est script.


## 2026-04-26 03:48 UTC final verification refresh
- Re-ran syntax checks after review fixes: pass.
- Re-ran node contracts and Python contracts: pass.
- Re-ran 
pm run test:e2e:dev:scenario-chunk-runtime: 4 passed.
- Re-ran 
pm run test:e2e:dev:tno-ready-state: 5 passed.
- Re-ran 
pm run test:e2e:interaction-funnel: 3 passed.
- Re-ran 
pm run perf:baseline: pass and rewrote baseline files.
- Re-ran 
pm run perf:gate: pass against refreshed baseline.
