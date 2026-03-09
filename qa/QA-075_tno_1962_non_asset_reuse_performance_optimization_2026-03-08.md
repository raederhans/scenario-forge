# QA-075 TNO 1962 Non-Asset-Reuse Performance Optimization (2026-03-08)

## Scope
- Theme: `tno_1962` runtime performance work that does **not** depend on asset reuse / incremental build.
- This archive is separate from:
  - `QA-071` seam / runtime political fixes
  - `QA-074` asset reuse / incremental build planning
- Goal of this round:
  - reduce duplicated `physical` clip work
  - split heavy and light context passes
  - make scenario apply reach first paint earlier
  - move hit-canvas rebuild off the first-paint critical path

## Baseline
Baseline numbers were taken from the earlier `tno_1962` benchmark archive already referenced in `QA-071`.

- `tno_1962 idleFullRedraw`: about `9987 ms`
- `tno_1962 context`: about `9214 ms`
- `physical_off` probe: total about `822 ms`, context about `35 ms`
- `political`: about `359 ms`
- `borders`: about `60 ms`
- `buildSpatialIndex`: about `12 ms`
- conclusion before this round:
  - the hotspot was concentrated in `context`
  - the hotspot stayed almost entirely inside `physical`
  - `dynamic borders`, `relief overlays`, `scenario water`, and `special overlays` were not the main problem

## Implemented Changes
### 1. Shared physical clip
- File: `js/core/map_renderer.js`
- `drawPhysicalAtlasLayer()` and `drawPhysicalContourLayer()` now accept `clipAlreadyApplied`.
- `drawPhysicalLayer()` applies `applyPhysicalLandClipMask()` once, then draws atlas + contours inside the same clip scope.
- Target of this change:
  - reduce `applyPhysicalLandClipMask.callCount` from `2` to `1`

### 2. Context split
- File: `js/core/map_renderer.js`
- Old single `context` pass was split into:
  - `contextBase`: `physical + urban + rivers`
  - `contextScenario`: `scenario water + scenario special + scenario relief`
- Cache keys, invalidation reasons, pass counters, and idle/interacting composition were updated to understand the two-pass model.
- File: `js/core/state.js`
  - render-pass cache state now tracks `contextBase` / `contextScenario`
  - counters now track `contextBasePassRenders` / `contextScenarioPassRenders`

### 3. Staged scenario apply
- File: `js/core/map_renderer.js`
- Heavy scenarios now use staged warmup:
  - Stage A: first paint with political/background/borders
  - Stage B: deferred `contextBase` warmup
  - Stage C: deferred hit-canvas warmup
- New metrics recorded:
  - `setMapDataFirstPaint`
  - `setMapDataContextBaseReady`
  - `setMapDataHitCanvasReady`

### 4. Lazy hit canvas
- File: `js/core/map_renderer.js`
- `render()` no longer forces hit-canvas rebuild on every idle frame.
- `ensureHitCanvasUpToDate()` now supports:
  - deferred idle build
  - forced strict build only when click/double-click validation actually needs it
- `getLandHitFromPointer()` now avoids forcing the canvas path for simple hover / obvious spatial hits.

### 5. Perf / benchmark instrumentation alignment
- File: `js/core/map_renderer.js`
  - perf overlay now shows:
    - `contextBase`
    - `contextScenario`
    - `setMapDataFirstPaint`
    - `setMapDataContextBaseReady`
    - `setMapDataHitCanvasReady`
    - `buildHitCanvas`
  - `contextBreakdown` now also shows repeated call counts when present
- File: `ops/browser-mcp/editor-performance-benchmark.py`
  - benchmark invalidation was updated from legacy `context` to `contextBase` + `contextScenario`
  - default benchmark URL was corrected from `127.0.0.1:18080` to `127.0.0.1:8000`
- File: `ops/browser-mcp/run-editor-performance-benchmark.sh`
  - wrapper URL default was also corrected to `127.0.0.1:8000`

## Benchmark Evidence
Artifact:
- `.mcp-artifacts/perf/editor-performance-benchmark.json`

Screenshots:
- `.mcp-artifacts/perf/none-home.png`
- `.mcp-artifacts/perf/hoi4_1939-home.png`
- `.mcp-artifacts/perf/tno_1962-home.png`

### Console
- Log: `.playwright-cli/console-2026-03-09T02-16-46-161Z.log`
- Result: `0` warnings, `0` errors

### Network
- Log: `.playwright-cli/network-2026-03-09T02-16-47-214Z.log`
- Checked `tno_1962` requests:
  - `manifest.json`: `200`
  - `countries.json`: `200`
  - `owners.by_feature.json`: `200`
  - `controllers.by_feature.json`: `200`
  - `cores.by_feature.json`: `200`
  - `water_regions.geojson`: `200`
  - `special_regions.geojson`: `200`
  - `relief_overlays.geojson`: `200`
  - `runtime_topology.topo.json`: `200`

### Before / After Summary
`tno_1962`

- `idleFullRedraw`
  - before: about `9987 ms`
  - after: `4124.7 ms`
  - delta: about `-58.7%`
- `context`
  - before: about `9214 ms`
  - after: `3366.2 ms`
  - delta: about `-63.5%`
- `scenarioApply`
  - before: multi-second and strongly blocked by full first-frame work; prior archive used the older all-in critical path
  - after: `3161.2 ms`
- `setMapDataFirstPaint`
  - after: `2062.2 ms`
- `setMapDataContextBaseReady`
  - after: about `6173.9 ms`
- `setMapDataHitCanvasReady`
  - after: about `6339.9 ms`
- `applyPhysicalLandClipMask.callCount`
  - before: effectively `2` inside the physical layer path
  - after: `1`

Control scenes

- `none idleFullRedraw`: `952.0 ms`
- `hoi4_1939 idleFullRedraw`: `1021.8 ms`
- `none idle context`: `235.6 ms`
- `hoi4_1939 idle context`: `235.5 ms`

### TNO 1962 Context Breakdown After Patch
Idle redraw:
- `contextBase`: `3363.7 ms`
- `contextScenario`: `2.5 ms`
- `applyPhysicalLandClipMask`: `3296.4 ms`
- `drawPhysicalAtlasLayer`: `18.8 ms`
- `drawPhysicalContourLayer`: `14.1 ms`
- `drawUrbanLayer`: `0.7 ms`
- `drawRiversLayer`: `33.6 ms`

Probe results:
- `baseline`: total `4480.3 ms`, context `3525.6 ms`
- `physical_off`: total `882.2 ms`, context `34.9 ms`
- `urban_off`: total `4458.6 ms`, context `3479.1 ms`
- `rivers_off`: total `4645.0 ms`, context `3597.0 ms`
- `physical_urban_rivers_off`: total `899.5 ms`, context `6.0 ms`

## Findings
### Confirmed wins
- Shared clip worked:
  - `applyPhysicalLandClipMask.callCount` is now `1`
- Staged apply worked:
  - first visible paint now lands around `2062 ms`
  - `contextBase` and hit canvas are no longer on the first-paint critical path
- Lazy hit canvas worked:
  - click / double-click remain functional
  - full hit-canvas rebuild is no longer forced at every idle render
- Context split worked:
  - fill operations now avoid dragging the heavy context path back into every action frame
  - click and double-click action frames stayed in the political/border path instead of forcing a context redraw

### Remaining bottleneck
- The remaining bottleneck is still overwhelmingly the `physical` land clip, not contour drawing detail.
- Evidence:
  - `applyPhysicalLandClipMask`: `3296.4 ms`
  - `drawPhysicalAtlasLayer` + `drawPhysicalContourLayer`: only about `32.9 ms` combined
  - `physical_off` collapses context from `3525.6 ms` to `34.9 ms`
- Conclusion:
  - this round already extracted most of the “easy renderer-only” win
  - contour LOD was **not** executed in this round because the new data shows contour drawing is not the dominant cost anymore
  - if more non-asset-reuse optimization is needed, the next likely direction is bitmap / transform reuse for `contextBase`, not contour simplification

## Compatibility Notes
- No builder changes were made in this round.
- No `runtime_topology` schema changes were made in this round.
- No scenario save/load schema changes were made in this round.
- Existing `dynamic borders off` and `scenario relief overlays off` default behavior remained intact.

### Runtime topology compatibility boundary
- `ATL sea` remains a political feature and does not fall back to `scenario_water`.
- `scenario_water` in `tno_1962` continues to contain only `congo_lake`.
- `excluded_water_region_groups = ["mediterranean"]` remains part of the scenario contract.
- `contextBase` invalidation must follow the active land-mask source:
  - `runtime topology`
  - `scenario land mask`
  - `scenario context land mask`
  - `landBgData / landDataFull` fallback
- `contextScenario` invalidation must follow scenario overlay and runtime-topology changes, not only the UI toggles.
- `staged apply` and `lazy hit canvas` are only valid if Mediterranean Atlantropa AOI does not fall through to default open ocean during first paint or early interaction.

## Reproduction
1. Start the local editor server on `http://127.0.0.1:8000/`.
2. Run:
   - `python3 ops/browser-mcp/editor-performance-benchmark.py`
3. Inspect:
   - `.mcp-artifacts/perf/editor-performance-benchmark.json`
   - `.mcp-artifacts/perf/tno_1962-home.png`
   - `.playwright-cli/console-2026-03-09T02-16-46-161Z.log`
   - `.playwright-cli/network-2026-03-09T02-16-47-214Z.log`

## Patch Summary
- `js/core/map_renderer.js`
  - shared physical clip
  - split context into base/scenario passes
  - staged map-data warmup
  - deferred/lazy hit-canvas build
  - perf overlay updates
- `js/core/state.js`
  - added staged-apply / deferred-hit state and new render-pass cache fields
- `ops/browser-mcp/editor-performance-benchmark.py`
  - benchmark pass-name alignment and localhost default fix
- `ops/browser-mcp/run-editor-performance-benchmark.sh`
  - localhost default fix

## Deferred Next Step
- Not executed in this round:
  - contour LOD tuning
  - scenario-aware pre-rasterized `physical` base
  - asset reuse / incremental build work
- Recommended next step if further gains are required before the builder-side work:
  - keep `contextBase` as a reusable bitmap across idle transform settles in `balanced`
  - otherwise return to the builder-side `context_land_mask` simplification / asset reuse track
