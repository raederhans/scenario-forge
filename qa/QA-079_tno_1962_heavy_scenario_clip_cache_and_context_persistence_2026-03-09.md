# QA-079 TNO 1962 Heavy-Scenario Clip Cache And Context Persistence (2026-03-09)

## Summary
- Goal: execute the next `tno_1962` performance round after bundle slimming, focusing on:
  - `context_land_mask v3`
  - persistent `contextBase` reuse in `balanced`
  - heavy-scenario clip cache
- Result:
  - runtime browsing performance improved very substantially
  - startup / first-paint improved moderately
  - the biggest win came from renderer-side caching, not from builder-side mask reduction
- Stage C (`runtime_topology` split) was not implemented in this round.

## Console
- Benchmark console capture: [.playwright-cli/console-2026-03-09T16-45-18-533Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-09T16-45-18-533Z.log)
- Result: `0` errors, `0` warnings in the benchmark run.

## Network
- Benchmark network capture reference: [.playwright-cli/network-2026-03-09T16-45-19-804Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-09T16-45-19-804Z.log)
- No new scenario-loading failures were surfaced by the benchmark run.

## Screenshot
- Benchmark home screenshot: [.mcp-artifacts/perf/tno_1962-home.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/perf/tno_1962-home.png)

## Patch Summary
### 1. Builder-side `context_land_mask v3`
- File: [tools/patch_tno_1962_bundle.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/patch_tno_1962_bundle.py)
- Changes:
  - switched from pure global simplify to a hybrid mask attempt:
    - coarse global simplification outside protected AOIs
    - exact shoreline retention inside protected AOIs
  - protected AOIs used in the final version:
    - west Mediterranean
    - Libya-Suez
    - Aegean
    - Bosphorus / Black Sea mouth
    - Congo lake ring
- Current output:
  - `context_land_mask_tolerance`: `0.25`
  - `context_land_mask_area_delta_ratio`: `0.004038272036402618`
  - `context_land_mask_fallback_used`: `false`
  - `context_land_mask_arc_refs`: `60744`

### 2. Persistent `contextBase` reuse
- File: [js/core/map_renderer.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js)
- Changes:
  - `contextBase` reuse is now bucket-aware instead of using the previous transform-sensitive exact-refresh behavior
  - `balanced` heavy-scenario reuse now keys by zoom bucket:
    - `low`: `< 1.4`
    - `mid`: `1.4 - 2.5`
    - `high`: `> 2.5`
  - quiet-window exact refresh now only forces `contextBase` rebuild when one of these is true:
    - zoom bucket changes
    - large pan distance exceeds the heavy-scenario viewport threshold
    - minor contour threshold is crossed

### 3. Heavy-scenario clip cache
- File: [js/core/map_renderer.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js)
- Changes:
  - `applyPhysicalLandClipMask()` now builds and reuses a cached `Path2D` clip path
  - cache key includes:
    - active scenario
    - render profile
    - viewport / DPR
    - projection signature
    - context zoom bucket
    - mask source / feature count / arc ref estimate
    - scenario runtime topology signature
- Result:
  - exact `physical` clip cost dropped from multi-second to low single-digit milliseconds on cached redraws

## Measured Results
Baseline used for comparison:
- previous `tno_1962 scenarioApply`: `3960.7 ms`
- previous `tno_1962 idleFullRedraw`: `3888.9 ms`
- previous `tno_1962 idle contextBase`: `2785 ms`
- previous `tno_1962 idle physicalClip`: `2685 ms`

Current benchmark:
- Benchmark file: [.mcp-artifacts/perf/editor-performance-benchmark.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/perf/editor-performance-benchmark.json)

### `tno_1962`
- `scenarioApply`: `3006.3 ms`
- `setMapData firstPaint`: `2117.9 ms`
- `setMapData contextBaseReady`: `2868.6 ms`
- `idleFullRedraw`: `976.4 ms`
- `idle contextBase`: `71.9 ms`
- `idle physicalClip`: `3.1 ms`
- `physicalClip cacheHit`: `true`
- `zoom settle first visible frame`: `5.0 ms`
- `zoom settle exact refresh`: `769.4 ms`
- `singleFill action`: `17.8 ms`
- `doubleClickFill action`: `16.4 ms`

### `hoi4_1939`
- `scenarioApply`: `2607.1 ms`
- `setMapData firstPaint`: `1942.7 ms`
- `setMapData contextBaseReady`: `2909.0 ms`
- `idleFullRedraw`: `849.8 ms`
- `idle contextBase`: `66.2 ms`
- `idle physicalClip`: `1.2 ms`

## Interpretation
### What improved
- `tno_1962` is no longer dominated by multi-second `contextBase` redraws.
- The main renderer win came from clip path reuse plus more persistent `contextBase` reuse.
- The remaining gap to `hoi4_1939` is now much smaller:
  - `scenarioApply`: `3006.3 ms` vs `2607.1 ms`
  - `idleFullRedraw`: `976.4 ms` vs `849.8 ms`

### What did not improve as planned
- `context_land_mask v3` did not achieve the intended arc-ref reduction target.
- Previous round `context_land_mask_arc_refs`: `59881`
- Current round `context_land_mask_arc_refs`: `60744`
- That means:
  - the builder-side protected-mask approach is currently visually safer than a much more aggressive global simplify
  - but it did not become the main reason performance improved

### Practical conclusion
- This round is still a success from a user-facing performance standpoint.
- But the success came primarily from renderer architecture:
  - persistent background reuse
  - cached clip path
- The builder-side `context_land_mask v3` remains an unfinished optimization track and should not be treated as “solved”.

## Runtime Bundle State
- Current [runtime_topology.topo.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/runtime_topology.topo.json) size: `14,473,845` bytes
- Current `context_land_mask` diagnostics from [manifest.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/manifest.json):
  - tolerance `0.25`
  - area delta `0.004038272036402618`
  - fallback `false`
  - arc refs `60744`

## Deferred / Next Steps
- `runtime_topology` split remains deferred.
- If another performance round is needed, the best next builder-side target is not “more of the same simplify”, but one of:
  - smaller or more targeted protected AOIs
  - AOI-aware seam blending that reduces protected-zone perimeter cost
  - a separate coarse ocean/context clip mask distinct from the current protected shoreline mask

## Validation Notes
- `python3 -m py_compile tools/patch_tno_1962_bundle.py`: passed
- `git diff --check` on [tools/patch_tno_1962_bundle.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/patch_tno_1962_bundle.py) and [map_renderer.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js): passed
- Full bundle rebuild completed successfully
- Browser benchmark completed successfully
