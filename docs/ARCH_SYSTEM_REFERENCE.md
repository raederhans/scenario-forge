# ARCH System Reference

## Purpose
This document is a technical reference for contributors and future agents working on the current Scenario Forge architecture (Python data pipeline + browser hybrid renderer).

## Directory Structure

### `map_builder/`
- `config.py`: Global constants for data sources, map bounds, simplification, quantization, and country expansion rules.
- `io/`: Fetch and cache helpers.
  - `fetch.py`: Downloads Natural Earth and GeoJSON sources, with local cache and mirror fallback.
  - `readers.py`: Layer-specific readers (`rivers`, `urban`, `physical`) and normalization.
- `processors/`: Country/region replacement modules used to build the hybrid political layer.
  - `admin1.py`: Admin-1 extension and country-code extraction.
  - `france.py`, `poland.py`, `china.py`, `russia_ukraine.py`, `south_asia.py`: Country-specific geometry replacement.
  - `special_zones.py`: Disputed/wasteland overlays.
- `geo/`:
  - `utils.py`: CRS normalization, clipping, geometry rounding, island culling.
  - `topology.py`: TopoJSON build + post-processing (stable IDs + embedded neighbor graph).
- `outputs/save.py`: Preview generation and output writing.

### `js/core/`
- `state.js`: Single shared mutable app state object (map data, colors, UI toggles, caches, indexes).
- `data_loader.js`: Loads topology + locale + hierarchy JSON.
- `map_renderer.js`: Hybrid renderer and interaction engine.
- `color_manager.js`: Auto-fill color algorithms (region and political graph coloring).
- `logic.js`: Shared color application helpers used by UI.
- `legend_manager.js`, `file_manager.js`: Legend and project import/export helpers.

### `js/ui/`
- `toolbar.js`: Tool, palette, overlay, style, and auto-fill controls.
- `sidebar.js`: Country list, presets, hierarchy groups, legend editor, project actions.
- `i18n.js`: Language toggling and translated label resolution.

### `tools/`
- Build/diagnostic utilities, not runtime app code.
- Examples: `generate_hierarchy.py`, `translate_manager.py`, `debug_topology.py`, `patch_topology.py`, `scout_russia.py`, `dev_server.py`.

## Data Pipeline (Current Global Admin-0 Build)

### End-to-end flow
1. `init_map_data.py` bootstraps dependencies and downloads base datasets.
2. Admin-0 source data is parsed and normalized to EPSG:4326.
3. Global clipping/filtering runs (`clip_to_map_bounds`, optional allowlist, micro-island blacklist).
4. Core layers are fetched and simplified (`rivers`, `borders`, `ocean`, `land`, `urban`, `physical`).
   - Ocean coverage is validated with bbox thresholds before topology export.
   - If under-covered, ocean is rebuilt as `world_bbox - unary_union(land)` fallback.
5. Political layer schema is normalized:
   - `id`: stable unique string, based on ISO code and deterministic suffixing (`ISO__n`) for duplicates.
   - `cntr_code`: normalized uppercase country code.
6. Metadata enrichment runs (country-code recovery, optional subdivision fields).
7. Global culling/cleanup runs (tiny geometry cull, ID stabilization, de-duplication checks).
8. `save_outputs(...)` writes intermediate artifacts and preview image.
9. `build_topology(...)` writes `data/europe_topology.json` (kept for compatibility).
10. Post-build tooling runs:
    - `tools/generate_hierarchy.py` -> `data/hierarchy.json`
    - `tools/translate_manager.py` -> `data/locales.json`

### Topology and neighbor graph details
`map_builder/geo/topology.py` performs:
- Layer column pruning and geometry cleaning.
- TopoJSON generation via `topojson.Topology(...)` with quantization (`TOPOLOGY_QUANTIZATION`) and shared coordinates.
- Strict political schema normalization:
  - `properties.id` required, stable, unique string.
  - `properties.cntr_code` required and normalized.
  - top-level `geometry.id` mirrors `properties.id`.
- Spatial neighbor graph computation (`compute_neighbor_graph`) using GeoPandas spatial index/`intersects`.
- Embedding of graph as `objects.political.computed_neighbors`.

## Frontend Architecture

### Startup path
1. `js/main.js` calls `loadMapData()`.
2. Topology objects are decoded into GeoJSON features (`topojson.feature(...)`).
3. `initMap()` initializes renderer internals with global projection (`d3.geoEqualEarth`), canvas/SVG layers, caches, and events.
4. `setMapData()` rebuilds indexes/meshes and fits projection.
5. UI modules (`toolbar`, `sidebar`, `i18n`) bind controls and mutate shared `state`.

### Hybrid renderer model
`js/core/map_renderer.js` uses two rendering surfaces:
- Canvas (`#map-canvas`): high-volume geometry draw path (`ocean -> political -> physical -> urban -> rivers -> borders`).
- SVG (`#map-svg`): interaction rectangle + overlays (hover highlight, special zones, editor preview, legend).

This keeps heavy polygon drawing off the DOM while preserving SVG ergonomics for overlay layers.

Ocean rendering sequence on canvas:
1. Base sphere/ocean fill (`#aadaff`).
2. Optional ocean style overlay (`flat`, `bathymetry_soft`, `bathymetry_contours`, `wave_hachure`).
   - Renderer resolves mask mode per frame:
     - `topology_ocean` when ocean bbox quality is sufficient.
     - `sphere_minus_land` fallback when topology ocean coverage is too small.
   - As of 2026-02-24, advanced presets are temporarily runtime-disabled for performance stabilization.
3. Political land fills.
4. Context layers (`physical`, `urban`, `rivers`) with style-configurable blend/opacity/line systems.
5. Hierarchical borders (`local -> province -> parent -> country -> coastline`), with zoom-aware styling.

Context layer source resolution:
- Runtime resolver evaluates `primary` vs `detail` per layer via:
  - `computeLayerCoverageScore(collection)`
  - `pickBestLayerSource(primary, detail, policy)`
  - `resolveContextLayerData(layerName)`
- Resolver records diagnostics in:
  - `state.contextLayerSourceByName`
  - `state.layerDataDiagnostics`
- `special_zones` supports detail-first fallback when primary layer is missing.

### State and interaction model
- Global mutable state lives in `state.js`.
- Hit-testing uses a screen-space spatial grid (`spatialGrid`) over projected feature bounds.
- Strict land hit policy: a candidate is valid only when `d3.geoContains(feature, lonLat) === true`.
- Hover and click share the same hit pipeline (`getHitFromEvent`), and ocean areas return empty hit results.
- Zoom/pan is D3 zoom; renderer redraws canvas on transform updates.
- Giant-artifact culling is unified across draw, spatial index, and autofill candidate loops.
- Large-country allowlist (`RU`, `CA`, `CN`, `US`, `AQ`, `ATA`) prevents accidental culling in global projection.
- Color maps are sanitized before use to prevent invalid canvas style values.

## Key Algorithms

### Auto-Fill (Graph Coloring)
Implemented by `ColorManager.computePoliticalColors(...)` + `autoFillMap("political")`:
1. Build country adjacency from `objects.political.computed_neighbors` (preferred) or `topojson.neighbors` fallback.
2. Greedy graph-color countries with a constrained palette while avoiding neighbor collisions.
3. Broadcast country colors to feature IDs with robust fallback chain:
   - direct feature ID match
   - country-level color
   - user `state.countryPalette`
   - deterministic hash fallback

### Island Coloring Strategy
Implemented in `ColorManager.computePoliticalColors(...)`:
- Countries with neighbors (`degree > 0`) use greedy graph coloring.
- Isolated countries (`degree == 0`) use deterministic hash-based palette selection by country code.
- If neighbor graph is unavailable globally, all countries use hash-based palette selection (order-independent).
- Feature-level fallback colors use hashed feature/country token, never fixed index defaults.

### Artifact Culling in Render Loop
Implemented in `map_renderer.js`:
- Compute feature projected bounds (`pathCanvas.bounds(feature)`).
- Flag as giant when feature bounds exceed 95% of canvas width and height.
- Cull only non-allowlisted giant features.
- Apply the same predicate in:
  - `drawCanvas()` (visual suppression)
  - `buildSpatialIndex()` (prevent hidden artifacts from capturing hits)
  - `autoFillMap()` (prevent hidden artifacts from polluting color maps)

### Coastline LOD and De-clutter
Implemented in `map_renderer.js`:
- Coastline mesh is generated from primary topology and cached as three levels:
  - `cachedCoastlinesHigh` (raw)
  - `cachedCoastlinesMid` (moderate simplification)
  - `cachedCoastlinesLow` (aggressive simplification)
- Simplification uses client-side Ramer-Douglas-Peucker plus short-segment filtering.
- Runtime LOD selection by zoom:
  - `k < 1.8 -> low`
  - `1.8 <= k < 3.2 -> mid`
  - `k >= 3.2 -> high`
- At low zoom, local/province internal borders are intentionally weakened to reduce high-latitude line crowding.

### Parent Unit Borders (Per-country, Auto-discovered)
Implemented in `map_renderer.js` + `toolbar.js`:
- New runtime state:
  - `state.parentBorderSupportedCountries`
  - `state.parentBorderEnabledByCountry`
  - `state.parentBorderMetaByCountry`
  - `state.parentGroupByFeatureId`
  - `state.cachedParentBordersByCountry`
- Group source resolver is automatic per country:
  - priority: `hierarchy` -> `admin1_group`
  - GB special-case: reject coarse 4-nation grouping; fallback to `id` prefix grouping (`UK***`) when hierarchy is not fine enough.
  - DE special-case: enforce federal-state level (`admin1_group`) with city-state presence (`Berlin`, `Hamburg`, `Bremen`).
- Quality gates for auto-enrollment:
  - minimum grouped coverage: `>= 0.70`
  - dominant group share: `<= 0.90`
  - renderable groups: `>= 2` (groups with at least 2 members)
- Rendering behavior:
  - parent borders are opt-in per country and cached lazily.
  - border order: `local -> province -> parent -> country -> coastline`.
  - parent borders are skipped during interaction phase to avoid pan/zoom jank.

### Ocean Mask Fallback (Hybrid)
Implemented in `map_renderer.js` + `init_map_data.py`:
- Frontend diagnostic state:
  - `state.oceanMaskMode`: `topology_ocean` or `sphere_minus_land`
  - `state.oceanMaskQuality`: bbox-area quality score in `[0, 1]`
- Frontend runtime selection:
  - Compute `ocean_bbox_area / sphere_bbox_area`.
  - Use topology mask when quality `>= 0.35`; otherwise use `Sphere - Land` clip (`evenodd`).
- Pipeline guardrails:
  - Validate ocean bbox against global thresholds (`width >= 220°`, `height >= 90°` on global builds).
  - If invalid, force fallback ocean geometry from `world_bbox - unary_union(land_bg)`.

### Special Zone Manual Editor (Project-local)
Implemented in `map_renderer.js` + `toolbar.js` + `file_manager.js`:
- Draw model: `Vertex Polygon` (click add vertex, double-click finish).
- Runtime state:
  - `state.manualSpecialZones` (FeatureCollection)
  - `state.specialZoneEditor` (active/type/label/vertices/selectedId/counter)
- Effective render set:
  - `topology special_zones + manualSpecialZones`.
- Styling:
  - type-aware (`disputed`, `wasteland`, `custom`) fill/stroke palette from `styleConfig.specialZones`.
- Persistence:
  - Project schema v4 includes `manualSpecialZones` and all context style/visibility fields.

## Current Baseline Metrics
`data/europe_topology.json` (primary):
- File size: `3,391,805` bytes (~3.2 MB)
- Objects: political, ocean, land, urban, physical, rivers
- Arcs: `36,370`
- Political geometries: `199`
- Ocean geometries: `2` (known sparse-coverage input; frontend fallback handles runtime masking)
- Embedded political neighbor rows: `199`

`data/europe_topology.highres.json` / `.bak` (detail):
- Includes `special_zones` object (`2` features), used as runtime fallback source.

## Architectural Notes
- The pipeline now targets global Admin-0 with compatibility-preserving output path names.
- UI modules directly mutate `state` and call render functions; this is simple but tightly coupled.
- Renderer keeps production/debug modes, defensive color sanitation, and global-safe artifact suppression.
