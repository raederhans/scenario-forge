# RFC: Global Migration (Europe/Eurasia -> World)

## Status
Draft

## Objective
Define the technical changes required to evolve the current single-file Europe/Eurasia topology build into a scalable global map system.

## Baseline (Current Build)
- Runtime topology file: `data/europe_topology.json`
- Current size: ~6.9 MB (`7,147,228` bytes)
- Political geometries: `8,305`
- Total arcs: `91,877`
- Projection in renderer: `d3.geoMercator()` + `projection.fitSize(...)`
- Loading mode: single eager download (`js/core/data_loader.js` defaults to one topology URL)

## Feasibility Assessment

### Data size and loading impact
The current payload is already near 100k arcs for a region-focused build. A global build can scale into very different regimes depending on granularity:

| Scenario | Approx political features | Approx arcs (inference) | Approx single payload | Feasibility as one file |
|---|---:|---:|---:|---|
| Global Admin-1 only | 4k-8k | 120k-250k | 12-35 MB | Possible, but heavy on slower clients |
| Mixed global (Admin-1 + selected Admin-2) | 20k-80k | 300k-1.2M | 40-180 MB | Risky as one file |
| Full global Admin-2 | 200k-400k+ | 2M-6M+ | 200 MB+ | Not viable as one file |

Inference basis: current build ratio is roughly `11 arcs / political feature` (91,877 / 8,305) before full-world density effects.

### Recommendation
Move to **on-demand loading**. A single monolithic world Admin-2 TopoJSON is not a safe production target for browser startup latency, memory, or interaction smoothness.

## Projection Strategy

### Current
- `js/core/map_renderer.js` initializes `d3.geoMercator()` and then `fitSize` to loaded land data.

### Global recommendation
1. Default world projection: `d3.geoEqualEarth()` (equal-area thematic readability, good global balance).
2. Optional alternate projection: `d3.geoMercator()` for users who prefer familiar web map shape.
3. Implement projection factory in renderer state (e.g., `state.projectionName`) and re-run `fitProjection()` when changed.
4. Keep anti-meridian behavior explicit (test Pacific-centered and Atlantic-centered views).

## Hardcoded Regional Logic That Must Be Removed or Refactored

### Pipeline blockers
- `map_builder/geo/utils.py`: `clip_to_europe_bounds(...)` hard-uses `cfg.MAP_BOUNDS`.
- `map_builder/config.py`:
  - `MAP_BOUNDS = (-25, 0, 180, 83)`
  - Europe/Eurasia-centric country sets and description.
- `init_map_data.py`:
  - `filter_countries(...)` geographic mask (`reps.y >= 30` and `reps.x >= -30`).
  - `LATITUDE_CROP_BOUNDS = (-180, -55, 180, 73)` and `crop_to_latitude_band(...)` applied to all layers.
  - Workflow assumes Europe/NUTS as base source.

### Processor-level regional assumptions
- `map_builder/processors/admin1.py`: admin1 layer clipped to Europe bounds.
- `map_builder/processors/china.py`: `clip_to_europe_bounds(...)` on China ADM2.
- `map_builder/processors/russia_ukraine.py`: custom RU clip box and Ural split assumptions.
- `map_builder/processors/south_asia.py`: hardcoded island cull coordinates for India.

These must become configurable region rules or be moved to optional country plugins.

## Performance Risk: TopoJSON Client and Arc Volume

### Will `topojson` choke at 100k arcs?
- Likely no immediate failure: current build is already ~92k arcs and operational.
- Real risk starts as arc and geometry counts move far above this (decode time + per-frame draw loops + hit-testing cost).

### Current frontend bottlenecks to address before global
- Full political feature traversal in `drawCanvas()` each frame.
- Eager full-topology load in `loadMapData()`.
- Hit-testing based on quadtree candidates + `geoContains` can degrade at larger geometry counts.

### Optimization strategies
1. **Data partitioning**: split into tiles/regions/countries with manifest metadata.
2. **Layer partitioning**: keep political core separate from optional context layers (`urban`, `physical`, `rivers`).
3. **LOD artifacts**: build multiple simplification levels (world, regional, local).
4. **Quantization tuning**: calibrate `TOPOLOGY_QUANTIZATION` per LOD profile.
5. **On-demand decode**: load by viewport/country selection, not all at boot.
6. **Worker/offscreen path**: move expensive decode/preprocessing off main thread where possible.

## Proposed Target Architecture (Global)

### Data products
- `manifest.json`: lists available regions/countries/layers, extents, and URLs.
- `world_admin0_admin1.topology.json`: lightweight startup layer.
- `country/{ISO_A2}_adm2.topology.json`: lazy detail files.
- Optional context packs: `context/rivers.topology.json`, `context/urban.topology.json`, etc.

### Frontend loading model
1. Startup loads only world coarse layer.
2. On zoom threshold or country focus, fetch detail topology for intersecting countries.
3. Evict distant detail layers from memory using an LRU policy.
4. Keep color map by stable feature IDs across layer swaps.

## Migration Plan (High-Level)
1. Remove hardcoded Europe clipping and convert to configurable regional guards.
2. Introduce global projection switch and QA anti-meridian behavior.
3. Build manifest + chunked topology output format in pipeline.
4. Refactor frontend loader/renderer for incremental data acquisition.
5. Add performance gates (startup time, FPS under zoom, memory budget).

## Decision
Proceed with global migration only if architecture changes (manifest + chunking + LOD) are accepted. Full world Admin-2 in one file is explicitly out of scope for production quality.
