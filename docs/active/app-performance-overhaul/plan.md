# App Performance Overhaul Plan

## Current phase
2026-04-29 five-step interaction performance slice: pass attribution, dirty/cache narrowing metrics, cost-aware scheduling visibility, worker v2 protocol, and black-pixel attribution.

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


## 2026-04-26 14:50 UTC interaction black-frame and zoom closeout plan addendum
- Scope stays frozen to renderer continuity, chunk-promotion visual commit slicing, and editor benchmark evidence.
- Keep interactionComposite optimization; during INTERACTING only reuse an already valid composite and defer building missing composites to settling/idle.
- Reuse continuity frames across DPR/topology/stale-age drift only when scenario and canvas size still match, and record drift reasons as metrics.
- Keep scenarioChunkPromotionRenderLocked through the second yield and flushRenderBoundary; a stale post-visual run restores political chunk data before yielding ownership.
- Benchmark acceptance uses firstIdleAfterLastWheelMs plus black-pixel-ratio samples and screenshot artifacts in .runtime/browser/mcp-artifacts/perf.


## 2026-04-26 21:51 UTC zoom-interaction-architecture execution addendum
- This execution intentionally lands the low-risk prerequisite slice first: bounded exact-after-settle helper extraction, double-buffer exact compose, color invalidation narrowing, and rAF batching for brush preview.
- Worker rasterization, fallback-cache deletion, and broader frame scheduler work remain follow-up phases after the safe slice is stable under E2E and perf gates.
- Guardrail: protected zoom-end chunks are scoped to the previous zoom-end required political detail ids and stale post-apply refreshes, so idle refresh cannot evict the visible detail selection immediately after zoom-end.

## 2026-04-26 review follow-up addendum
- Preserve the zoom-end detail protection, but let real post-zoom scenario apply/detail prewarm refreshes run.
- Treat refresh source start time as the ownership token: source before zoom-end metric may be stale; source after zoom-end metric is current user work.

## 2026-04-26 23:35 UTC exact-after-settle controller execution addendum
- Execute only the next approved slice: local exact-after-settle controller, first-batch rAF interaction writes, and fallback audit preservation.
- Keep controller local to map_renderer: generation + phase + pending plan, with finalize after drawCanvas() exact compose.
- First-batch interaction writes are dev-selection plus land/water direct color helpers; brush commit, sovereignty, and special-region paths stay synchronous.
- Fallback cleanup remains evidence-only: keep lastGoodFrame and drawBaseVisibleFrameFallback, preserve runtime metric sources.

## 2026-04-27 full zoom/drag black-frame overhaul execution
- User requested Ralph execution for all remaining planned phases.
- Scope: pre-gate A metrics contract, pre-gate B request/flush ownership, phase 1 sliced exact-after-settle scheduling, phase 2 atomic composite identity, phase 3 political dirty + rAF batching, phase 4 fallback inventory, phase 5 flag-off political raster worker protocol.
- Parent owns implementation and all live verification. Subagents are static-only lanes.
- Stop condition: if a phase target cannot be verified with fresh metrics, remain on that phase and record blocker.

## 2026-04-27 执行偏差
- 本轮优先完成两道前置门与五阶段骨架。阶段 1 exact 指标在 benchmark 中已降到 11.5ms，但 wheel idle/long task/black ratio 仍超出阶段阈值。
- 阶段 4 采用保留 guardrail 的 inventory 结果；删除 fallback 缓存会扩大风险。
- 阶段 5 只提交 default-off 协议壳与契约，实际 raster offload 需要在下一轮以 worker lane 独立实现。

## 2026-04-29 repeated zoom performance execution plan

### Goal
Quantify and reduce repeated zoom degradation across TNO Europe, US East, and East Asia without visual downgrade.

### Scope
- Extend editor benchmark to schema 3.2 with repeatedZoomRegions and region-level degradation, memory, long-task, black-pixel, scheduler, and chunk metrics.
- Fix cumulative runtime work: stale chunk refresh discard, focus country hint TTL, protected detail chunks excluded from current merge, and post-commit replay reason/currentness.
- Make frame scheduler and exact-after-settle work generation-aware and input-aware.
- Reduce UI hot-path noise in zoom toolbar, sidebar inspector/preset refresh, day/night UTC interval, and render-boundary reason tracking.
- Add chunk manifest cost fields and make chunk selection cost-aware while preserving existing feature identity and scenario semantics.

### Verification
- Parent thread owns all live tests and perf gates.
- Subagents remain static-only.
- Required gates: perf contract, scenario chunk contracts, perf probe behavior, Python unit contracts, dev E2E, and perf gate.
- Full repeatedZoomRegions live benchmark is the measurement artifact for final region degradation comparison.

### Closeout note
- Final repeatedZoomRegions benchmark passed the 1.25 degradation target for all three regions: Europe 0.9039, US East 1.0131, East Asia 1.0632.
- Cost-aware selection now lowers high-cost detail selection in complex regions while keeping center/overlap relevance ahead of raw cost.
- This active folder stays open for future worker raster and political/background full-pass architecture slices.

## 2026-04-29 five-step interaction performance execution

### Goal
Complete the next low-risk architecture slice after repeated zoom reached target ratios: make the remaining political/background full-pass cost visible, reduce repeated scheduling noise, and land a default-off worker v2 protocol without changing the default visual path.

### Scope
- Upgrade editor benchmark/report contracts to schema 3.3 with `passAttributionSchema="mc_pass_attribution_v1"`.
- Add repeated-zoom pass attribution for political background/fill/stroke, contextScenario, labels, hit canvas, scheduler queue, chunk costs, and worker state.
- Extend black-pixel samples with region-level classification so dark map content and blank-frame candidates are distinguishable.
- Record political pass visible candidate stats alongside existing hit-canvas visible/global/cell-span metrics.
- Upgrade the political raster worker shell to protocol v2 with request identity, task result, stale/accepted/fallback counters, and default-off safety.

### Verification
- Parent thread owns all syntax, contract, E2E, benchmark, baseline, and perf-gate execution.
- Subagents remain static-only and review-only.
- Required gates: perf gate contract, scenario chunk contracts, perf probe behavior, relevant Python compile/unit checks, dev E2E, editor benchmark, perf baseline, and perf gate.

### Acceptance
- Default worker-off path remains visually and behaviorally unchanged.
- `repeatedZoomRegions` keeps Europe, US East, and East Asia degradation ratios at or below 1.25.
- Benchmark output exposes pass-level attribution and black-pixel classification for every repeated zoom cycle.
- Worker flag-on path records accepted/stale/fallback metrics without forcing political raster into the default render path.
- Active docs, task checklist, review notes, and final verification evidence stay in this folder.
