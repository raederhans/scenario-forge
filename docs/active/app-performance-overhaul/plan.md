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


## 2026-04-24 Direct interaction performance closeout

- Hover hot path: add interaction action/rank/hover overlay/facility probe/city probe duration metrics.
- Hover metric sampling: counters increment every call; hover detail entries record every 10th call or any sample >= 8ms.
- Hover overlay: mousemove path queues one RAF render; force render, mouseleave, facility card actions, and zoom start stay synchronous.
- Click warmup: observe new click/action/rank metrics first; defer any hit-canvas warmup change until forced build cost is proven dominant.
- Runtime hooks: keep sidebar and toolbar hooks eager for URL replay and startup boot.

## 2026-04-25 Map interaction speed slice

- Benchmark v3.1: add explicit schema/source fields and same-scenario context for direct interaction metrics.
- Zoom/pan: add a conservative interaction composite cache for main color/context passes; borders, texture labels, and labels stay independent.
- Hover: add hover-only first-containing strict hit path; click and dblclick keep strict canvas validation and snap behavior.
- Post-ready: expose pending task keys/count and retry counters through the existing diagnostics path.
- Verification stays parent-owned; subagents remain static-only.

## 2026-04-25 Remediation addendum

- Keep interactionRecoveryTaskMs/window reserved for user-triggered recovery work; startup post-ready infrastructure uses postReadyInteractionInfrastructure* metrics.
- Treat perf report schema fields as gate contracts so stale baselines fail early.
- Continuity frame reuse is allowed only inside the same scenario, canvas/DPR, and topology revision.
- Explicit chunk focus overrides have priority during zoom-end probes and focused detail loading.

## 2026-04-26 interaction-continuity-and-promotion-slicing

### Goal
Fix the current map interaction regression without reverting the whole interaction-composite optimization:
- Drag must never fall through to full-screen ocean fill after a fast-frame miss.
- Zoom-end promotion work must not run as one synchronous main-thread block.
- Hit canvas must not scan all land features when the spatial index is temporarily unavailable.

### Owner files
- `js/core/map_renderer.js`: fast-frame decision tree, interactionComposite identity, firstVisibleFramePainted, hit canvas spatial-unavailable behavior.
- `js/core/state/renderer_runtime_state.js`: render cache/default state shape.
- `js/core/scenario/chunk_runtime.js`: async single-flight promotion commit and commit-stage metrics.
- `js/core/state/scenario_runtime_state.js`: serializable promotion commit status fields.
- `js/main.js`: post-ready/backlog handling for promotion commit in-flight status.
- Tests under existing contract files only; no new orphan test entrypoints.

### Implementation contract
- Fast-frame path validates transformed passes and `interactionComposite` identity/signature before `resetMainCanvas()`.
- `firstVisibleFramePainted` starts false, resets on scenario apply/reset/rollback, and becomes true only after a real visible frame succeeds.
- Fast-frame miss order is: transformed frame -> lastGoodFrame -> keep existing pixels during `INTERACTING` -> exact compose during `SETTLING` or `IDLE + deferExactAfterSettle` -> ocean fill only for initial/no-data frames.
- `interactionComposite` stores `scenarioId/topologyRevision/dpr/pixelWidth/pixelHeight` and refuses mismatched reuse.
- `commitPendingScenarioChunkPromotion()` becomes the single async commit entrypoint; module-scope `promotionCommitPromise` owns single-flight, while runtime state stores only serializable status/run id/in-flight fields.
- Promotion commit uses render-lock semantics across slices: apply merged payload -> yield -> revalidate -> apply political payload with render suppressed -> yield -> revalidate -> `flushRenderBoundary()` -> release lock.
- Renderer stage metrics keep `scenarioChunkPromotion*StageMs`; chunk commit internal metrics use `chunkPromotionCommitInfraMs` and `chunkPromotionCommitVisualMs`.
- `drawHitCanvas()` returns false and keeps `hitCanvasDirty` when spatial index is unavailable; it no longer falls back to `runtimeState.landData.features.forEach`.

### Metrics and acceptance
Track before/after values for:
- `missingVisibleFrameCount`
- `buildHitCanvas`
- `scenarioChunkPromotionInfraStageMs`
- `scenarioChunkPromotionVisualStageMs`
- `zoomEndToChunkVisibleMs`
- `wheelAnchorTrace.firstIdleAfterWheelMs`
- `wheelAnchorTrace.maxLongTaskMs`

Acceptance:
- Long drag produces no new full-screen ocean fill frame after first visible frame.
- `missingVisibleFrameSkippedDuringInteraction` may increase during drag; `missingVisibleFrameCount` should not increase on the interaction path.
- `drawHitCanvas` records spatial-index-unavailable as built=false and does not run an all-feature fallback loop.
- Promotion commit status prevents a synchronous settle-time promotion block and keeps exact-after-settle from racing the same tick.
- Existing node, Python contract, dev E2E, and perf gates pass from a fresh run.

### Verification order
1. Syntax checks: `node --check` on changed JS files and `python -m py_compile` on changed Python tests.
2. Node contracts: renderer runtime, scenario runtime, scenario chunk contracts.
3. Python contracts: scenario chunk refresh, spatial orchestration, scenario runtime state, rollback, perf gate.
4. E2E: scenario chunk runtime, TNO ready-state, interaction funnel if hit/click path is touched.
5. Perf: `npm run perf:baseline`, then `npm run perf:gate`.

