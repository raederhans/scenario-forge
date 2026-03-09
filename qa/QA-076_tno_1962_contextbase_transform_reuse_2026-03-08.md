# QA-076 TNO 1962 ContextBase Transform Reuse (2026-03-08)

## Scope
- Theme: `tno_1962` runtime performance work focused on `contextBase` transform reuse in `balanced`.
- This archive is separate from:
  - `QA-071` seam / runtime political fixes
  - `QA-074` asset reuse / incremental build planning
  - `QA-075` non-asset-reuse renderer optimizations before transform reuse
- Goal of this round:
  - remove the heavy `contextBase` exact redraw from the foreground zoom-settle path
  - keep `full` on the old exact path
  - avoid builder / runtime bundle changes

## Baseline
Baseline numbers came from the post-`QA-075` benchmark state before this patch.

- `tno_1962 zoom settle frame`: about `5379.1 ms`
- `tno_1962 zoom restored idle frame`: about `5345.3 ms`
- `tno_1962 contextBase`: about `4290.0 ms` / `4172.5 ms`
- current transformed interactive frame before this patch: about `3.7 ms`

Conclusion before this round:
- the remaining foreground hitch was no longer the total `context` pipeline
- it was specifically the forced exact `contextBase` redraw that fired after zoom settle
- the right target was response-path reuse, not another broad renderer refactor

## Implemented Changes
### 1. Per-pass reference transforms
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
- `renderPassCache.referenceTransform` was extended with per-pass storage:
  - `renderPassCache.referenceTransforms[passName]`
- Each cached pass now remembers its own transform snapshot.
- `drawTransformedPass()` now reads the pass-specific reference transform instead of relying on one shared transform for every pass.

### 2. Transformed reuse extended from `interacting` to `settling`
- File: `js/core/map_renderer.js`
- The old `drawInteractiveFrameFromCaches()` path was generalized into a transformed-frame compositor.
- `RENDER_PHASE_SETTLING` now uses the same transformed cache composition model that `RENDER_PHASE_INTERACTING` already used.
- Result:
  - zoom end no longer immediately forces a full exact redraw
  - the first visible settle frame stays in the same low-latency path as interactive motion

### 3. `balanced`-only `contextBase` transform reuse policy
- File: `js/core/map_renderer.js`
- `contextBase` now has a separate reuse decision in `balanced` for heavy scenarios.
- Transform-only changes no longer invalidate `contextBase` immediately.
- Exact refresh is only requested when at least one threshold is crossed:
  - scale ratio outside `0.88` to `1.14`
  - logical pan distance above `192 px`
  - crossing the minor-contour threshold at `k = 2.0`
  - viewport / DPR / scenario / topology / physical style / land-mask source changes
- If none of those fire, `contextBase` stays on transformed bitmap reuse.

### 4. `idle` fast handoff plus delayed exact refresh
- File: `js/core/map_renderer.js`
- `scheduleRenderPhaseIdle()` no longer immediately pays the exact `contextBase` redraw cost after settle.
- New behavior:
  - idle first keeps the transformed result on screen
  - a low-priority exact-after-settle task starts with a `450 ms` quiet window
  - if the user moves again, the pending exact refresh is canceled
- If the quiet window expires:
  - `background / political / effects / contextScenario / dayNight / borders` refresh exactly
  - `contextBase` only refreshes exactly when the reuse thresholds say it must

### 5. Metrics and benchmark updates
- Files:
  - `js/core/map_renderer.js`
  - `ops/browser-mcp/editor-performance-benchmark.py`
- Added metrics:
  - `settleFastFrame`
  - `settleExactRefresh`
  - `contextBaseExactRefresh`
  - `contextBaseReuseSkipped`
  - `contextBaseReuseScaleRatio`
  - `contextBaseReuseDistancePx`
- Benchmark now records the split between:
  - first visible settle frame
  - exact-after-settle refresh

## Evidence
### Console
- Log: `.playwright-cli/console-2026-03-09T02-46-04-907Z.log`
- Result: `0` warnings, `0` errors

### Network
- Log: `.playwright-cli/network-2026-03-09T02-46-06-058Z.log`
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

### Screenshot
- `.mcp-artifacts/perf/tno_1962-home.png`

### Benchmark Artifact
- `.mcp-artifacts/perf/editor-performance-benchmark.json`

## Benchmark Before / After
### TNO 1962
- `scenarioApply`
  - before this round: already improved by staged apply in `QA-075`
  - after: `4043.6 ms`
- `idleFullRedraw`
  - after: `5446.7 ms`
  - note: this is **not** the primary target of this patch

### Zoom settle split
- `zoom settle first visible frame`
  - before: about `5379.1 ms`
  - after: `2.6 ms`
  - improvement: about `-99.95%`
- `zoom idle fast frame`
  - after: `3.5 ms`
  - path: transformed composite only
- `zoom exact-after-settle refresh`
  - before: effectively bundled into the old `~5345.3 ms` restored idle frame
  - after: `935.5 ms`
  - `exactRefreshObserved: true`
  - `contextBaseRefreshed: false`
  - `reason: transform-reuse`
  - `scaleRatio: 1.12`
  - `distancePx: 60.83`

### Fill behavior after the patch
- `singleFill`
  - action duration: `19.2 ms`
  - action frame: `4.2 ms`
  - later idle frame: `1329.9 ms`
- `doubleClickFill`
  - action duration: `18.5 ms`
  - action frame: `3.1 ms`
  - later idle frame: `814.5 ms`

### Control scenes
- `none`
  - zoom settle frame: `1.3 ms`
  - exact-after-settle refresh: not used
- `hoi4_1939`
  - zoom settle frame: `1.9 ms`
  - exact-after-settle refresh: not used

Conclusion:
- `tno_1962` settle response is now in the same rough visible-latency class as the lighter scenes
- the remaining exact work has been moved out of the first visible response path

## Settle First-Frame vs Exact-Refresh Split
- The first visible frame now uses transformed cache composition and stays in single-digit milliseconds.
- The later exact refresh is still real work, but it runs after the quiet window and only refreshes `contextBase` when thresholds require it.
- In the recorded benchmark case:
  - exact refresh still happened
  - `contextBase` exact redraw was skipped
  - the exact refresh cost came from the non-`contextBase` passes, not from replaying the heavy physical clip

## Visual Risks And Accepted Tradeoffs
- Accepted in `balanced`:
  - short-lived background resampling feel after zoom settle
  - temporary reuse of the previous `contextBase` bitmap while the editor is still within small transform deltas
- Not accepted:
  - political or border misalignment
  - sea/land clip leaks
  - shoreline cracks
  - hit-canvas or ownership/controller regressions
- `full` was intentionally left on the exact path to avoid changing its visual behavior in this round.

## Residual Bottleneck
- This patch improves visible responsiveness, not exact redraw cost in the worst case.
- `idleFullRedraw` is still multi-second for `tno_1962`.
- If a transform crosses the reuse thresholds, `contextBase` can still become a heavy exact redraw.
- Recommended next steps if more gains are needed:
  - scenario-aware `contextBase` bitmap persistence / pre-raster reuse
  - builder-side `context_land_mask` or asset-reuse work already tracked elsewhere

## Reproduction
1. Start the local editor server on `http://127.0.0.1:8000/`.
2. Run:
   - `python3 ops/browser-mcp/editor-performance-benchmark.py`
3. Inspect:
   - `.mcp-artifacts/perf/editor-performance-benchmark.json`
   - `.mcp-artifacts/perf/tno_1962-home.png`
   - `.playwright-cli/console-2026-03-09T02-46-04-907Z.log`
   - `.playwright-cli/network-2026-03-09T02-46-06-058Z.log`

## Patch Summary
- `js/core/map_renderer.js`
  - per-pass transform references
  - transformed-frame reuse extended to settle
  - `balanced`-only `contextBase` reuse thresholds
  - delayed exact-after-settle refresh with cancelation
  - new settle/reuse perf metrics
- `js/core/state.js`
  - state for exact-after-settle scheduling and per-pass transform references
- `ops/browser-mcp/editor-performance-benchmark.py`
  - benchmark split between settle fast frame and exact-after-settle refresh

## Follow-up Note (2026-03-09)
- After the initial patch, a new intermittent symptom was reported during drag:
  - the cached bitmap-like `contextBase` could appear to stay near an older map position and leave a ghosted impression
- Static code review found a real risk in the exact idle composition path:
  - `composeCachedPasses()` used raw `drawImage(passCanvas, 0, 0)` for every pass
  - after an exact-after-settle refresh that skipped `contextBase` exact redraw, different passes could legally have different reference transforms
  - that meant `contextBase` could still be cached in an older transform space while other passes had already been refreshed to the current transform
- Fix applied in `js/core/map_renderer.js`:
  - `composeCachedPasses()` now checks each pass against the current transform
  - if a pass reference transform differs, it is composed through `drawTransformedPass()` instead of raw `drawImage`
- Expected effect:
  - exact idle composition no longer assumes all cached passes share one transform
  - this should remove the intermittent “old basemap stays in place” ghost path without forcing a full `contextBase` redraw
