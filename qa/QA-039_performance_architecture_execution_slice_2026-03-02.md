# QA-039: Performance and Architecture Execution Slice (2026-03-02)

## Summary

- Implemented the first execution slice of the performance and data-architecture plan.
- Added runtime render profiles with deferred detail loading so ordinary machines can start from coarse topology and promote to detailed topology after first paint.
- Added hidden hit-canvas picking, profile-based DPR caps, and interaction-phase layer throttling to reduce main-thread load during pan, zoom, hover, and fill operations.
- Added build modes, manifest generation, and strict validation so data-contract drift is now detectable instead of remaining silent.
- Strict validation is intentionally failing on the current dataset, which confirms there are still real data-contract risks to fix in follow-up work.

## Scope Implemented

### 1. Runtime loading strategy

- `render_profile=auto|balanced|full` added to frontend startup.
- `auto` and `balanced` can defer detailed political topology until after initial render.
- Startup now preserves primary topology as the first-paint source instead of always blocking on `na_v2`.
- Deferred promotion loads:
  - `data/europe_topology.na_v2.json`
  - `data/europe_topology.runtime_political_v1.json`
- Deferred promotion is applied without resetting zoom or refitting the projection.

### 2. Renderer performance controls

- Added hidden hit-canvas picking so idle hover/click can avoid full geometry containment work on the hot path.
- Added render-profile DPR caps:
  - `auto`: max effective DPR `1.25`
  - `balanced`: max effective DPR `1.5`
  - `full`: native DPR
- Added interaction-phase throttling:
  - `physical`
  - `urban`
  - `rivers`
  are skipped during active interaction unless profile is `full`.
- Added bounds-based culling for political fills and context layers.
- Added RAF-coalesced render dispatch for UI-triggered redraw bursts.

### 3. Dynamic border correctness

- Sovereignty batch operations now schedule border recomputation instead of only marking dirty state.
- Fixed the main batch paths:
  - map click batch sovereignty operations
  - sidebar hierarchy apply
  - sidebar preset apply
  - toolbar sovereignty clear

### 4. Build and validation pipeline

- `init_map_data.py` now supports:
  - `--mode all`
  - `--mode primary`
  - `--mode detail`
  - `--mode i18n`
  - `--strict`
- Added `data/manifest.json` generation with artifact metadata and hashes.
- Added validation for:
  - duplicate IDs
  - missing names
  - illegal sentinel IDs
  - missing computed neighbors
  - hierarchy child IDs missing from reference topology
  - alias conflicts
  - runtime political ID drift

## Browser Verification

### URL

- `http://127.0.0.1:8000/?render_profile=auto`
- `http://127.0.0.1:8000/`

### Console evidence

- `Loaded primary topology data/europe_topology.json (199 features).`
- `render_profile=auto deferred detail loading`
- `Loaded detail(na_v2) topology data/europe_topology.na_v2.json (11120 features).`
- `Deferred detail promotion applied`
- Composite coverage after promotion:
  - `detail=11116`
  - `primary=31`
  - `total=11147`

### Network evidence

Successful runtime requests observed:

- `data/europe_topology.json`
- `data/locales.json`
- `data/geo_aliases.json`
- `data/hierarchy.json`
- `data/ru_city_overrides.geojson`
- `data/special_zones.geojson`
- `data/europe_topology.na_v2.json`
- `data/europe_topology.runtime_political_v1.json`

Only notable failure:

- blocked Google Fonts request (`ERR_BLOCKED_BY_CLIENT`)

### Screenshot

历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。

## Build Verification

### Syntax checks

- `node --check js/main.js`
- `node --check js/core/data_loader.js`
- `node --check js/core/map_renderer.js`
- `node --check js/ui/sidebar.js`
- `node --check js/ui/toolbar.js`
- `python -m py_compile init_map_data.py tools/build_runtime_political_topology.py tools/geo_key_normalizer.py tools/translate_manager.py`

All passed.

### Mode verification

- `python init_map_data.py --mode i18n`
  - exit code `0`
  - regenerated:
    - `data/hierarchy.json`
    - `data/geo_aliases.json`
    - `data/locales.json`
    - `data/manifest.json`

## Strict-Mode Findings

`python init_map_data.py --mode i18n --strict` fails as expected on current data. This is not a regression in the validator. It is confirmation that the dataset still contains unresolved contract issues.

### Current failures

- `europe_topology.na_v2.json`
  - `missing_names=2`
  - `illegal sentinel ids=5`
  - `missing computed_neighbors`
- `europe_topology.runtime_political_v1.json`
  - `illegal sentinel ids=4`
- `hierarchy.json`
  - `child ids missing from runtime topology=64`
- `geo_aliases.json`
  - `conflicts=1112`
- runtime political ID drift
  - expected `11135`
  - actual `11098`
  - missing `37`
  - extra `0`

### Interpretation

- The new validator is working.
- The detailed runtime political artifact is still not a complete single source of truth.
- Hierarchy, aliases, and runtime political composition are still partially divergent.
- Some data hygiene problems are still being masked in non-strict mode.

## Remaining Risks

### Data-contract risks

- hierarchy child coverage is not yet topology-authoritative
- runtime political composition does not yet fully match expected feature coverage
- alias conflict volume is too high for long-term confidence
- sentinel ID policy is not yet formalized

### Build risks

- `sjoin_nearest` is still running in geographic CRS in existing geospatial tooling and continues to emit warnings
- non-strict builds can still ship artifacts that would be rejected by strict validation

### Runtime risks

- this slice reduces load substantially, but it does not yet implement full dirty-rect redraw or complete layer cache partitioning
- hit-canvas picking is now present, but geometry fallback still exists and will continue to matter whenever hit buffers are stale

## Recommended Follow-up

1. Make runtime political topology the single authoritative detailed contract and derive hierarchy from that artifact only.
2. Fix strict-mode blockers in this order:
   - missing names
   - illegal sentinel IDs
   - computed neighbors
   - hierarchy child drift
   - runtime political ID drift
   - alias conflicts
3. Move all `sjoin_nearest` workflows to projected metric CRS before any further detail expansion.
4. Add metrics instrumentation for first paint, draw cost, hit-test latency, and batch sovereignty latency so later work can be measured instead of inferred.
5. Finish renderer restructuring with explicit cache layers and dirty-region redraw.

## Files Touched In This Slice

- `init_map_data.py`
- `js/core/data_loader.js`
- `js/core/map_renderer.js`
- `js/core/state.js`
- `js/main.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`
- `data/manifest.json`

## Status

- Plan execution started and partially implemented.
- Runtime performance posture is improved.
- Compatibility posture for ordinary hardware is improved.
- Architectural risk visibility is improved.
- Full plan is not complete yet; strict-mode failures identify the next mandatory cleanup tranche.

> 历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。
