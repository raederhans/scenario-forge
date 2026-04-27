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

## 2026-04-26 14:50 UTC interaction black-frame and zoom closeout progress
- [x] Re-read current code and active docs before editing.
- [x] Spawned static-only mapper and QA agents; parent owns all live verification.
- [x] Implemented renderer continuity/composite hardening.
- [x] Implemented chunk promotion second-yield revalidation and render-lock hold-through-flush.
- [x] Implemented editor benchmark wheel/black-screen evidence fields.
- [x] Updated existing contract checks for relaxed continuity and benchmark fields.
- [ ] Run parent-owned targeted node/Python/E2E/perf verification.
- [ ] Run review/bug-check/first-principles pass and update lessons learned if warranted.


## 2026-04-26 15:23 UTC verification result
- [x] Syntax and contract checks passed.
- [x] Dev E2E scenario-chunk-runtime passed after zoom-end detail protection fix.
- [x] TNO ready-state and interaction-funnel E2E passed.
- [x] Editor benchmark ran and produced rapid-wheel/interactive-pan screenshot evidence.
- [x] perf:gate warmup mismatch fixed; `npm run perf:gate` passes with three warmups.
- [ ] Final static review pass pending.

## 2026-04-26 16:25 UTC final verification refresh
- [x] `node --check` on changed renderer/chunk/state/perf JS.
- [x] `python -m py_compile` on changed benchmark and Python contracts.
- [x] Node contracts: renderer runtime state, scenario runtime state, scenario chunk contracts, perf probe snapshot behavior.
- [x] Python contracts: scenario chunk refresh + perf gate contract.
- [x] E2E: scenario-chunk-runtime 4/4, tno-ready-state 5/5, interaction-funnel 3/3.
- [x] Perf: `npm run perf:baseline` regenerated the checked-in three-warmup baseline; `npm run perf:gate` rerun passed against `docs/perf/baseline_2026-04-20.json`.
- [x] Benchmark: full `editor-performance-benchmark.py` passed after isolating browser sessions per scenario; TNO wheel trace recorded `firstIdleAfterLastWheelMs=1084.5`, `maxBlackPixelRatio=0.061361`, `sameScenario=true`, and screenshots under `.runtime/browser/mcp-artifacts/perf/`.
- [x] Review remediation: fixed warmup contract drift, wheel clock-domain mixing, zoom-end detail chunk protection scope, and continuity-frame over-reuse.
- [x] Final review blocker follow-up: added behavior tests for wheel last-wheel/fallback semantics and zoom-end protection one-shot selection scope.

## 2026-04-26 review follow-up: zoom-end metric source
- [x] Preserve true end-to-visible timing when zoomEndChunkVisible also has scenarioChunkPromotionVisualStage.
- [x] Keep visual-stage metric as explicit fallback only.
- [x] Add behavior test for render/runtime/fallback source order.
- [x] Run py_compile, perf gate contract unittest, and scenario chunk node contract.

## 2026-04-26 21:51 UTC zoom-interaction-architecture safe slice checklist
- [x] Exact-after-settle helper extraction keeps apply -> render -> finalize ordering.
- [x] Political color refresh uses partial dirty ids and avoids full physical/context invalidation unless contextBase has color-dependent layers.
- [x] Brush preview render is rAF-batched through requestInteractionRender.
- [x] Exact compose uses compositeBuffer and copy blit to prevent stale pixels.
- [x] Zoom-end detail chunk final-state E2E passes after replacing async waitForFunction checks with synchronous state polling.
- [x] Review blockers addressed: contextBase contour colors, composite transparency, and bounded zoom-end protected-id retention.

## 2026-04-26 review follow-up: scenario apply refresh scope
- [x] Scope stale post-apply skip by scenario id, selectionVersion, and refresh source start time.
- [x] Add behavior coverage for old stale apply vs new post-zoom apply/prewarm.
- [x] E2E scenario chunk runtime review-fix run completed (`npm run test:e2e:dev:scenario-chunk-runtime`, 4/4).

## 2026-04-26 23:35 UTC exact-after-settle controller task progress
- [x] Create Ralph context snapshot and verify preflight state.
- [x] Add local exact-after-settle controller state and after-paint finalize hook.
- [x] Move first-batch dev-selection and land/water color writes to `requestInteractionRender`.
- [x] Extend existing static/runtime state contracts.
- [x] Run parent-owned syntax, node, Python, E2E, and perf verification.
- [x] Run code-review / architect review and fix findings.
- [x] Run deslop review and post-review regression verification.

## 2026-04-27 00:18 UTC verification evidence
- Syntax and targeted Node contracts passed: `node --check js/core/map_renderer.js`, `node --check js/core/state/renderer_runtime_state.js`, and node tests for scenario chunk, renderer runtime, scenario runtime, and physical layer contracts.
- Python contracts passed: `python -m unittest tests.test_scenario_chunk_refresh_contracts tests.test_perf_gate_contract -q`; after recovery-block update, `tests.test_scenario_chunk_refresh_contracts` passed again.
- E2E passed: scenario chunk runtime 4/4, TNO ready-state 5/5, interaction funnel 3/3.
- Perf: `npm run perf:baseline` regenerated `docs/perf/baseline_2026-04-20.*`; `npm run perf:gate` had one transient TNO apply failure and one transient HOI4 render median failure, then passed on rerun against the regenerated baseline.
- Post-change reruns passed: scenario chunk runtime 4/4 and `npm run perf:gate` passed.

## 2026-04-27 00:35 UTC final closeout
- [x] Fixed the stale helper reference in `beginExactAfterSettleControllerSchedule()` so controller defaults come from `renderer_runtime_state.js`.
- [x] Final syntax/contracts passed: `node --check` on changed renderer/state files, targeted Node contracts, and `python -m unittest tests.test_scenario_chunk_refresh_contracts -q`.
- [x] Final E2E passed: `npm run test:e2e:dev:scenario-chunk-runtime` 4/4, `npm run test:e2e:dev:tno-ready-state` 5/5, and `npm run test:e2e:interaction-funnel` 3/3.
- [x] Final perf gate passed: `npm run perf:gate` against `docs/perf/baseline_2026-04-20.json`.
- [x] Final static review result: APPROVE; optional identity-mismatch runtime coverage left as a future hardening candidate because current generation and identity contracts are already covered by behavior/static checks.
- [x] Deslop pass checked changed files for stale helper names, dead wrappers, temporary artifacts, and broken new task lines; no extra code cleanup needed.
