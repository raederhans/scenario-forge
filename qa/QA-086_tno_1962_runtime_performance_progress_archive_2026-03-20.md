# QA-086 TNO 1962 Runtime Performance Progress Archive (2026-03-20)

## Scope
- Theme: `tno_1962` runtime interaction performance work after the `2026-03-09` benchmark baseline.
- This archive covers renderer-side work only:
  - zoom interaction
  - zoom settle / exact refresh
  - single-feature fill
  - clustered batch fill
  - sidebar follow-up refresh behavior
- This archive does **not** cover:
  - startup / loading pipeline redesign
  - builder output changes
  - scenario bundle schema changes
  - flaky click benchmark harness repair

## Baseline
Authoritative baseline artifact:
- `.runtime/browser/mcp-artifacts/perf/editor-performance-benchmark.json`
- timestamp inside artifact: `2026-03-09T12:45:21-04:00`

Relevant `tno_1962` baseline numbers:
- `interactivePanFrame`: `5.10 ms`
- `zoomSettleFrame`: `5.00 ms`
- `zoomExactRefresh`: `764.8 ms`
- `zoomExactRefresh.political`: `382.1 ms`
- `zoomExactRefresh.borders`: `61.2 ms`
- earlier fill symptom from the local benchmark series:
  - `singleFill.lastActionDurationMs`: about `17.8 ms`
  - `singleFill` later idle frame: about `1012 ms`
  - `doubleClickFill` later idle frame: about `618 ms`

Conclusion before this round:
- zoom gesture fast path was architecturally sound, but some passes still defeated cache reuse
- fill hot path still paid global state cleanup and full political redraw cost
- `political` was the dominant risk area for both fill and later zoom exact refresh work

## Implemented Progress
### 1. Low-risk runtime hot-path cleanup
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
- Implemented:
  - `dayNight` refresh is deferred while `renderPhase !== idle`
  - `political` pass signature stopped using `getColorsHash()` and now uses `state.colorRevision`
  - `refreshResolvedColorsForFeatures()` was reduced to incremental target-feature updates
  - sidebar follow-up refresh was batched with `requestAnimationFrame`
- Goal:
  - remove obvious per-click O(n) work before attacking repaint cost

### 2. Zoom borders snapshot reuse
- File:
  - `js/core/map_renderer.js`
- Implemented:
  - interaction-only border snapshot cache
  - zoom start captures a border snapshot
  - interacting / settling frames reuse that snapshot instead of live border redraw
  - border invalidation clears the snapshot immediately
- Result:
  - borders stopped being the main zoom interaction bottleneck

### 3. Partial political repaint
- File:
  - `js/core/map_renderer.js`
- Implemented:
  - dirty feature tracking through `renderPassCache.partialPoliticalDirtyIds`
  - dirty-rect merge
  - viewport coverage gate
  - spatial-grid candidate collection via `state.spatialItems` / `state.spatialGrid`
  - local background regrouping for partial redraw entries
  - partial repaint metrics and fallback reasons
- Result:
  - clustered fill operations stopped forcing full `political` redraw in the good cases

### 4. `politicalPathCache` introduction
- File:
  - `js/core/map_renderer.js`
- Implemented:
  - transform-scoped projected `Path2D` cache for political features
  - partial repaint path replay against cached paths
- Outcome:
  - this produced strong fill wins
  - but also introduced a new zoom regression because full exact render shared the same build path

### 5. Zoom regression repair work
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
- Implemented:
  - removed eager `politicalPathCache` build from full `drawPoliticalPass()`
  - full `political` pass now goes back to direct `pathCanvas(feature)` drawing
  - path cache is now used only by partial repaint and deferred warmup
  - added deferred warmup state:
    - `politicalPathWarmupQueue`
    - `politicalPathWarmupHandle`
    - `politicalPathWarmupSignature`
  - warmup is viewport-scoped, sliced, and canceled on non-idle transitions
  - partial repaint was changed to:
    - cheap gates first
    - then optional lazy path build
    - then redraw or fallback
- Current sync partial-build gate after tuning:
  - `candidateCount <= 96`
  - `uncachedCandidateCount <= 96`

## Measurement Method
### Static validation
- Commands used:
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/state.js`
- Status:
  - both passed after the current patch set

### Browser validation
- Runtime:
  - local server started with `python -u tools/dev_server.py '/?perf_overlay=1'`
  - page inspected through Playwright MCP at `http://127.0.0.1:8000/?perf_overlay=1`
- Probe style:
  - direct `page.evaluate(...)`
  - imports from:
    - `/js/core/state.js`
    - `/js/core/map_renderer.js`
    - `/js/core/scenario_manager.js`
- Why deterministic probes were used:
  - click-harness behavior was not stable enough for this round
  - deterministic mutation probes let us isolate renderer behavior directly

### Metrics tracked
- Render frame fields:
  - `state.renderPassCache.lastFrame.totalMs`
  - `lastFrame.timings.political`
  - `lastFrame.timings.borders`
- Perf metrics:
  - `state.renderPerfMetrics.politicalPartialRepaint`
  - `state.renderPerfMetrics.settleExactRefresh`
  - `state.renderPerfMetrics.politicalPathWarmup`
  - `state.renderPerfMetrics.politicalPathWarmupSlice`
- Counters:
  - `borderSnapshotRenders`
  - `borderSnapshotReuses`
  - `politicalPartialRepaints`
  - `politicalPartialFallbacks`
  - `politicalPartialCandidateCount`
  - `politicalPartialPathCacheMisses`
  - `politicalPartialPathBuild`
  - `politicalPathCacheBuild`
  - `politicalPathWarmupBuild`
  - `politicalPathWarmupSlices`
  - `politicalPathWarmupCancels`

## Validated Wins
### Fill path wins
Deterministic clustered single-feature probe:
- candidate seed: `BG331`
- estimated candidates: `40`
- partial repaint applied: `true`
- `political`: `0.5 ms`
- `pathCacheMisses`: `40`

Deterministic clustered 47-feature probe with controlled candidate set:
- seed: `IN_ADM2_76128533B15337568968545`
- estimated candidates: `92`
- partial repaint applied: `true`
- `political`: `0.9 ms`
- `pathCacheMisses`: `92`

Interpretation:
- clustered local edits can now tolerate cold cache and still stay on the partial path
- the latest sync build gate is large enough to keep medium clustered fills off the full redraw path

### Borders path wins
Across the zoom-focused work:
- `borders` exact-refresh cost dropped from baseline `61.2 ms` to low double/single-digit millisecond territory in the regression measurements
- border snapshot reuse remained functionally valid during interaction / settle

Interpretation:
- borders are no longer the dominant zoom bottleneck
- the remaining zoom cost is now elsewhere

### Smoke validation
Scenario smoke ran successfully in the browser for:
- `none`
- `hoi4_1939`
- `tno_1962`

Observed smoke results:
- `none`: `ok`
- `hoi4_1939`: `ok`
- `tno_1962`: `ok`

## Regression Timeline
### Stage A: fill wins, zoom regression introduced
After the first `politicalPathCache` rollout, the measured `tno_1962` zoom regression state was:
- `interactivePanFrame`: `6.27 ms`
- `zoomSettleFrame`: `5.30 ms`
- `zoomExactRefresh`: `1328.6 ms`
- `zoomExactRefresh.political`: about `807.6 ms`
- `zoomExactRefresh.borders`: about `12.7 ms`

Interpretation:
- borders got faster
- full `political` pass got much heavier
- net result: overall zoom exact refresh regressed badly

Root cause confirmed:
- full `drawPoliticalPass()` and partial repaint shared the same path-cache build mechanism
- zoom exact refresh rebuilt large amounts of `Path2D` in the foreground full render path

### Stage B: lazy-only repair
After removing eager full-pass path-cache build and moving the cache toward partial-only use, one deterministic zoom probe produced:
- `interactivePanFrame`: `4.03 ms`
- `zoomSettleFrame`: `4.13 ms`
- `zoomExactRefresh`: `956.2 ms`
- `zoomExactRefresh.political`: `528.9 ms`

Interpretation:
- interaction and settle latency recovered strongly
- exact refresh improved materially from the worst regression state
- exact refresh was still above the target line

### Stage C: current tuned state
After widening the sync partial-build gate to preserve clustered fill wins, the latest 3-run zoom average observed was:
- `interactivePanFrame`: `5.73 ms`
- `zoomSettleFrame`: `5.30 ms`
- `zoomExactRefresh`: `1138.8 ms`
- `zoomExactRefresh.political`: `633.9 ms`

Interpretation:
- current code still improves on the worst regression state
- but it is not yet back to the earlier best repair reading
- it remains clearly worse than the `2026-03-09` baseline

## Current State Assessment
### What is solid
- fill hot-path cleanup is real
- clustered partial repaint is real
- borders snapshot reuse is real
- smoke coverage across `none`, `hoi4_1939`, and `tno_1962` currently passes
- no new browser console errors were introduced in this round
- no network 4xx/5xx were observed during the final smoke run

### What is not solved
- `zoomExactRefresh` is still too expensive
- `political` full pass is still the main exact-refresh problem
- warmup no longer blocks the foreground path, but full `political` exact render still costs too much
- large or dispersed fill batches still correctly fall back, but they remain expensive when they do

### Current release decision
- Status: `Do not close perf QA yet`
- Reason:
  - fill path has meaningful wins
  - overall zoom performance is still not back to the baseline bar

## Console And Network Evidence
### Console
Latest browser console warnings were existing merge warnings, not new runtime errors:
- `[map_renderer] Scenario political background merge fallback engaged ...`

Observed status:
- `0` errors
- warnings only

### Network
Latest smoke and validation requests completed with `200` responses, including:
- `data/scenarios/tno_1962/manifest.json`
- `data/scenarios/tno_1962/countries.json`
- `data/scenarios/tno_1962/owners.by_feature.json`
- `data/scenarios/tno_1962/controllers.by_feature.json`
- `data/scenarios/tno_1962/cores.by_feature.json`
- `data/scenarios/hoi4_1939/manifest.json`
- `data/scenarios/hoi4_1939/countries.json`
- `data/scenarios/hoi4_1939/owners.by_feature.json`

Conclusion:
- the earlier local `hoi4_1939` manifest-fetch instability was not reproduced in the final smoke run

## Current Touch Points
Primary implementation files:
- `js/core/map_renderer.js`
- `js/core/state.js`

Key renderer entry points affected in this archive:
- `refreshResolvedColorsForFeatures()`
- `drawTransformedFrameFromCaches()`
- `drawPoliticalFeature()`
- `tryPartialPoliticalPassRepaint()`
- `drawPoliticalPass()`
- `renderPassToCache()`
- `drawCanvas()`
- `setRenderPhase()`
- political path warmup helpers

## Recommended Next Step
The next performance slice should target full `political` exact redraw cost directly.

Recommended order:
1. Reduce full `political` exact-render cost before touching cache lifecycle again.
2. Keep current clustered partial repaint wins intact.
3. Only after exact-render cost is lower, revisit whether warmup should stay, shrink, or be removed.

Most likely focus:
- full `political` pass candidate reduction / draw-cost reduction
- not another broad renderer refactor
- not another builder or schema change

## Reproduction
1. Start the local editor server:
   - `python -u tools/dev_server.py '/?perf_overlay=1'`
2. Open:
   - `http://127.0.0.1:8000/?perf_overlay=1`
3. Use deterministic Playwright browser probes that import:
   - `/js/core/state.js`
   - `/js/core/map_renderer.js`
   - `/js/core/scenario_manager.js`
4. Compare against:
   - `.runtime/browser/mcp-artifacts/perf/editor-performance-benchmark.json`

## Patch Summary
- `js/core/map_renderer.js`
  - deferred day/night refresh during interaction
  - `colorRevision`-based political signature
  - incremental color refresh hot path
  - batched sidebar refresh
  - border snapshot reuse during zoom
  - partial political repaint with spatial-grid candidate collection
  - `politicalPathCache` rollout
  - eager-build removal from full pass
  - deferred political path warmup
  - lazy partial-only path build gates
- `js/core/state.js`
  - render-pass cache fields for:
    - path cache
    - warmup queue / handle / signature
    - new perf counters

## Bottom Line
- This work has already produced real `tno_1962` fill improvements and real border-path zoom improvements.
- It has **not** yet restored overall zoom exact-refresh performance to the `2026-03-09` baseline.
- The project is now in a more diagnosable state:
  - local fill wins are isolated and reproducible
  - zoom exact-refresh cost is narrowed down much more specifically to full `political` redraw behavior
