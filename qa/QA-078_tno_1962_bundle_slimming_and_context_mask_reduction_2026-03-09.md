# QA-078 TNO 1962 Bundle Slimming And Context Mask Reduction (2026-03-09)

## Summary
- Goal: execute stage 1 and stage 2 of the `tno_1962` global performance plan without touching political semantics, hit-testing, or any larger donor rebuild chain.
- Scope completed:
  - compact JSON serialization for the generated `tno_1962` scenario bundle
  - second-pass runtime political property pruning
  - true lazy-load behavior for optional scenario layers that are off by default
  - stronger `context_land_mask` simplification for background-only clip usage
- Scope intentionally deferred:
  - splitting `runtime_topology_url` into separate political/context topology URLs

## Console
- Browser verification console log: [.playwright-cli/console-2026-03-09T15-53-27-976Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-09T15-53-27-976Z.log)
- Result: no new `tno_1962` scenario errors were introduced by this round.
- Only observed browser error in the verification session:
  - `404 favicon.ico`

## Network
- Browser verification network log: [.playwright-cli/network-2026-03-09T15-53-38-860Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-09T15-53-38-860Z.log)
- Initial `tno_1962` activation fetched:
  - `manifest.json`
  - `countries.json`
  - `owners.by_feature.json`
  - `controllers.by_feature.json`
  - `cores.by_feature.json`
  - `runtime_topology.topo.json`
- Initial `tno_1962` activation did not fetch:
  - `relief_overlays.geojson`
- First manual relief activation did fetch:
  - `relief_overlays.geojson`
- `water_regions` and `special_regions` were available in runtime state without standalone network requests because they were sourced from topology objects already embedded in `runtime_topology.topo.json`.

## Screenshot
- Verification screenshot: [.mcp-artifacts/perf/tno_1962-bundle-stage2-home.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/perf/tno_1962-bundle-stage2-home.png)

## Patch Summary
### Builder
- File: [tools/patch_tno_1962_bundle.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/patch_tno_1962_bundle.py)
- Changes:
  - switched generated JSON outputs to compact serialization
  - slimmed runtime political properties to the renderer/runtime subset actually used at load time
  - strengthened `context_land_mask` simplification and kept diagnostics in `manifest.json` and `audit.json`

### Runtime loading
- File: [js/core/scenario_manager.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js)
- Changes:
  - scenario bundle core load now eagerly fetches only:
    - `countries`
    - `owners`
    - `controllers`
    - `cores`
    - `runtime_topology`
  - optional layers now load according to default visibility and topology availability
  - default-off `relief_overlays` stays unloaded until first use

### UI toggles
- Files:
  - [js/ui/toolbar.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/toolbar.js)
  - [js/ui/sidebar.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js)
- Changes:
  - when a user enables an optional scenario layer, the toggle path now explicitly requests the layer on first use and reuses the cached payload afterward

## Bundle Size Deltas
- `runtime_topology.topo.json`
  - previous raw size: `52.78 MB`
  - previous compact-equivalent size: `16.31 MB`
  - current raw size: `13.84 MB`
- `relief_overlays.geojson`
  - previous raw size: `3.44 MB`
  - previous compact-equivalent size: `1.34 MB`
  - current raw size: `1.34 MB`

Current on-disk sizes:
- [runtime_topology.topo.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/runtime_topology.topo.json): `14,511,832` bytes
- [relief_overlays.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/relief_overlays.geojson): `1,401,371` bytes
- [owners.by_feature.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/owners.by_feature.json): `369,874` bytes
- [controllers.by_feature.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/controllers.by_feature.json): `369,968` bytes
- [cores.by_feature.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/cores.by_feature.json): `428,181` bytes
- [countries.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/countries.json): `112,238` bytes
- [water_regions.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/water_regions.geojson): `18,032` bytes
- [special_regions.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/special_regions.geojson): `42` bytes

## Runtime Property Pruning
- Runtime political properties per geometry:
  - previous average: `18.0`
  - current average: `11.0`
- Current retained runtime properties:
  - `__source`
  - `admin1_group`
  - `atl_surface_kind`
  - `cntr_code`
  - `detail_tier`
  - `id`
  - `interactive`
  - `name`
  - `region_group`
  - `render_as_base_geography`
  - `scenario_id`

## Context Land Mask Reduction
- Previous `context_land_mask` arc refs: `75,933`
- Current `context_land_mask` arc refs: `59,881`
- Current diagnostics from [manifest.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/manifest.json) and [audit.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/tno_1962/audit.json):
  - `context_land_mask_tolerance`: `0.2`
  - `context_land_mask_area_delta_ratio`: `0.004261985070167522`
  - `context_land_mask_fallback_used`: `false`
  - `scenario_runtime_topology_object_count`: `5`

## Benchmark Before / After
- Benchmark file: [.mcp-artifacts/perf/editor-performance-benchmark.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/perf/editor-performance-benchmark.json)

Key `tno_1962` deltas:
- `scenarioApply`
  - previous: `4043.6 ms`
  - current: `3960.7 ms`
- `idleFullRedraw`
  - previous: `5446.7 ms`
  - current: `3888.9 ms`
- `idle contextBase`
  - previous: `4277 ms`
  - current: `2785 ms`

Additional current `tno_1962` figures:
- `zoom settle first visible frame`: `5.7 ms`
- `zoom exact-after-settle refresh`: `1025.7 ms`
- `singleFill action`: `23.6 ms`
- `doubleClickFill action`: `24.3 ms`

Probe conclusion:
- `contextBase` remains the dominant cost center.
- `physical_off` still collapses `contextBase` from roughly `2798 ms` to roughly `48.1 ms`.
- This confirms that even after bundle slimming, the main remaining drag is still the heavy background clip path and not the political layer.

## Lazy Load Verification
State captured immediately after applying `tno_1962`:
- `showWaterRegions`: `true`
- `showScenarioSpecialRegions`: `true`
- `showScenarioReliefOverlays`: `false`
- runtime state payloads:
  - `water`: `true`
  - `special`: `true`
  - `relief`: `false`
- bundle cached payloads:
  - `water`: `false`
  - `special`: `false`
  - `relief`: `false`
- matching resource requests:
  - `runtime_topology.topo.json`
  - no `relief_overlays.geojson`

State after first relief enable:
- runtime state payloads:
  - `relief`: `true`
- bundle cached payloads:
  - `relief`: `true`
- matching resource requests:
  - `relief_overlays.geojson`

Conclusion:
- This round achieved real lazy loading for the default-off relief layer.
- `water` and `special` stay cheap at activation because they are served from embedded topology objects instead of separate fetches.

## Why Stage 3 Was Deferred
- The stage-3 idea was to split `runtime_topology_url` into separate political and context bundles.
- After this round, the evidence no longer points to startup payload parsing as the dominant bottleneck.
- The remaining slow path is still `contextBase` clip/render cost after activation, not the first network request set.
- Because of that, splitting topology URLs is still available, but it is no longer the next highest-value move.

## Residual Bottleneck
- `applyPhysicalLandClipMask` is still the major remaining hotspot.
- Current `maskSource` is still `scenarioContextLandMask`, and current `maskArcRefEstimate` is still `59,881`.
- The next meaningful gain is more likely to come from one of these directions:
  - a much lighter `context_land_mask`
  - stronger `contextBase` bitmap persistence / reuse
  - both together

## Validation Notes
- `python3 -m py_compile tools/patch_tno_1962_bundle.py`: passed
- `git diff --check` on the touched builder/runtime/UI files: passed
- `node --check` on the browser ES module files is not a useful validator in this repo as-is because the files are native ESM browser modules and Node treats them as CommonJS without a module package boundary.
