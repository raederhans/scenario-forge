# ARCH System Reference

## Purpose
This document is a technical reference for contributors and future agents working on the current Map Creator architecture (Python data pipeline + browser hybrid renderer).

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

## Data Pipeline (Current Europe/Eurasia Build)

### End-to-end flow
1. `init_map_data.py` bootstraps dependencies and downloads base datasets.
2. Base NUTS data is parsed and normalized to EPSG:4326.
3. Geographic clipping/filtering runs (`clip_to_europe_bounds`, country prefix filters, latitude crop).
4. Core layers are fetched and simplified (`rivers`, `borders`, `ocean`, `land`, `urban`, `physical`).
5. Hybrid political layer is assembled:
   - NUTS-derived features
   - Admin-1 extension (`build_extension_admin1`)
   - Country-specific replacements (FR, RU/UA, PL, CN, IN)
   - Special zones generation
6. Metadata enrichment runs (`cntr_code` recovery, subdivision grouping fields like `admin1_group`).
7. Global culling/cleanup runs (tiny geometry cull, ID fill + de-duplication).
8. `save_outputs(...)` writes intermediate artifacts and preview image.
9. `build_topology(...)` writes `data/europe_topology.json`.
10. Post-build tooling runs:
    - `tools/generate_hierarchy.py` -> `data/hierarchy.json`
    - `tools/translate_manager.py` -> `data/locales.json`

### Topology and neighbor graph details
`map_builder/geo/topology.py` performs:
- Layer column pruning and geometry cleaning.
- TopoJSON generation via `topojson.Topology(...)` with quantization (`TOPOLOGY_QUANTIZATION`) and shared coordinates.
- Promotion of `properties.id` to top-level `geometry.id` (stable string IDs).
- Spatial neighbor graph computation (`compute_neighbor_graph`) using GeoPandas spatial index/`intersects`.
- Embedding of graph as `objects.political.computed_neighbors`.

## Frontend Architecture

### Startup path
1. `js/main.js` calls `loadMapData()`.
2. Topology objects are decoded into GeoJSON features (`topojson.feature(...)`).
3. `initMap()` initializes renderer internals, projection, canvas/SVG layers, caches, and events.
4. `setMapData()` rebuilds indexes/meshes and fits projection.
5. UI modules (`toolbar`, `sidebar`, `i18n`) bind controls and mutate shared `state`.

### Hybrid renderer model
`js/core/map_renderer.js` uses two rendering surfaces:
- Canvas (`#map-canvas`): high-volume geometry draw path (ocean + political fill/stroke).
- SVG (`#map-svg`): interaction rectangle + overlays (hover highlight, special zones, legend).

This keeps heavy polygon drawing off the DOM while preserving SVG ergonomics for overlay layers.

### State and interaction model
- Global mutable state lives in `state.js`.
- Hit-testing uses a quadtree of feature bounds + `d3.geoContains` final check.
- Zoom/pan is D3 zoom; renderer redraws canvas on transform updates.
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

### Artifact Culling in Render Loop
Implemented in `drawCanvas()`:
- Compute feature screen bounds (`pathCanvas.bounds(feature)`).
- Skip drawing features that cover more than 80% of canvas width *and* height.
- Purpose: hide giant world-extent/bounding-polygon artifacts without regenerating source data.

## Current Baseline Metrics (from `data/europe_topology.json`)
- File size: `7,147,228` bytes (~6.9 MB)
- Objects: political, special_zones, ocean, land, urban, physical, rivers
- Arcs: `91,877`
- Political geometries: `8,305`
- Embedded political neighbor rows: `8,305`

## Architectural Notes
- The current pipeline is still region-specialized (Europe/Eurasia assumptions are hardcoded in config and clipping utilities).
- UI modules directly mutate `state` and call render functions; this is simple but tightly coupled.
- Renderer has production/debug modes and keeps defensive color sanitation active.
