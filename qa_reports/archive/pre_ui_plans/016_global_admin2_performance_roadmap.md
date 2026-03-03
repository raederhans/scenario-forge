# Global Admin-2 Performance Roadmap

## Scope
This document is a codebase audit and implementation roadmap for scaling to global Admin-2 while preserving interaction quality.

Audited areas:
- Python data pipeline (`init_map_data.py`, `map_builder/processors/*`, `map_builder/geo/topology.py`)
- Frontend renderer (`js/core/map_renderer.js`, `js/core/state.js`, `js/main.js`)
- Hierarchy/UI feed path (`tools/generate_hierarchy.py`, `js/ui/sidebar.js`)

## Current-State Audit

### 1) Data Pipeline ("Clean Up")

#### Island filtering status
- A real area-based filter exists only in `smart_island_cull`:
  - `map_builder/geo/utils.py:73`
  - Called in `init_map_data.py:603` with `threshold_km2=1000.0`.
  - Behavior: keep largest polygon per `id`, keep VIP whitelist points, keep polygons >= threshold.
- There is no global "remove islands < 50km²" policy.
- Some processors use area checks, but not for small-island removal and not in km²:
  - `map_builder/processors/china.py:81` uses `geometry.area` in EPSG:4326, then keeps `< 50.0` (artifact removal logic, unit is square degrees).
  - `map_builder/processors/poland.py:64` uses EPSG:4326 area with `< 2.0` artifact check.

#### Simplification and topology status
- Layer simplification is already applied pre-topology in many steps using config tolerances:
  - `map_builder/config.py:137` onward.
- Topology generation settings:
  - `map_builder/geo/topology.py:103` uses `prequantize=100_000` (good baseline).
  - `map_builder/geo/topology.py:106` has `toposimplify=False`.
  - `map_builder/geo/topology.py:105` has `presimplify=False`.
- Current output (from repo build artifact):
  - `data/europe_topology.json` ~7.9 MB
  - ~83,607 arcs, ~560,208 arc points
  - Political geometries: ~8,308
  - Urban geometries: ~9,169

### 2) Rendering Architecture ("Hybrid Engine")

#### Important correction
- The app is already partly Hybrid Canvas+SVG, not path-heavy SVG:
  - Base fills/strokes rendered on canvas in `js/core/map_renderer.js:408` and `js/core/map_renderer.js:445`.
  - SVG is used mainly for special zones and legend (`initSpecialZonesSvg`, `initLegendSvg`).
- Performance bottleneck is now per-frame canvas redraw and geometry traversal at scale, not DOM path count.

#### Interaction hit detection status
- Current picking path is quadtree + `geoContains`:
  - Index build: `js/core/map_renderer.js:668`
  - Pick query: `js/core/map_renderer.js:675`
- Hidden color-map infrastructure already exists but is not active in event path:
  - `drawHidden` exists in `js/core/map_renderer.js:605`
  - It is never called from the pointer hit pipeline.

#### Recommendation: Hidden Color Map vs Quadtree
- Best fit for current structure: **Hidden Color Map first**, with quadtree fallback.
- Why:
  - Existing `hitCanvas`, `idToKey`, `keyToId`, and draw routine already exist.
  - Picking cost becomes O(1) pixel read vs repeated `geoContains` checks.
  - Quadtree path can remain as fallback for debug and parity checks.

### 3) Interaction Optimization

#### Debounce/throttle status
- Mouse move is throttled: `MOUSE_THROTTLE_MS = 16` (`js/core/state.js:476`), used in `handleMouseMove` (`js/core/map_renderer.js:712`).
- Zoom render is requestAnimationFrame-gated:
  - `js/core/map_renderer.js:918` through `js/core/map_renderer.js:925`.

#### Culling status
- Viewport culling exists:
  - `pathBoundsInScreen` in `js/core/map_renderer.js:37`.
- Current issue:
  - Bounds are recomputed every frame via `boundsPath.bounds(feature)` for many layers.
  - Each frame still iterates all features in several loops, even if many are off-screen.

## Step-by-Step Implementation Plan

## Phase 1: Baseline and Instrumentation
- Goal: make performance measurable before changing architecture.
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
  - `init_map_data.py`
  - Optional dev utility: `tools/inspect_topology_perf.py` (new)
- Changes:
  - Add frame-time counters and per-layer draw timings.
  - Log feature counts actually drawn after culling.
  - Track hover hit-test time budget.
  - Add topology stats print (arcs, points, per-layer geoms) in build output.
- Complexity: Low
- Risks:
  - Minimal runtime overhead if logging is not gated.
  - Must keep instrumentation behind debug flag.

## Phase 2: Data Pipeline Cleanup (Area and Geometry Budget)
- Goal: reduce geometric complexity before frontend sees it.
- Files:
  - `map_builder/geo/utils.py`
  - `map_builder/config.py`
  - `init_map_data.py`
  - `map_builder/processors/china.py`
  - `map_builder/processors/poland.py`
  - `map_builder/processors/south_asia.py`
  - `map_builder/processors/russia_ukraine.py`
- Changes:
  - Introduce explicit km²-based tiny-island filter helper (equal-area CRS), not EPSG:4326 degree area.
  - Add per-layer thresholds in config, for example:
    - political tiny part threshold (candidate: 10-50 km²)
    - urban/physical optional thresholds
  - Inject filtering consistently after clip and before simplify for each high-density processor.
  - Keep whitelist behavior for strategic islands.
  - Convert current China/Poland artifact filters to projected-area checks.
- Complexity: Medium
- Risks:
  - Over-filtering can delete meaningful coastal admin units.
  - Needs a QA whitelist process for known sensitive islands and enclaves.
  - Could change country-specific historical presets if IDs disappear.

## Phase 3: Topology Compression Strategy
- Goal: shrink payload and decode cost while preserving border fidelity.
- Files:
  - `map_builder/geo/topology.py`
  - `map_builder/config.py`
  - `init_map_data.py`
- Changes:
  - Keep current prequantize baseline, then test stricter levels (100k -> 50k -> 25k).
  - Add optional topology simplification profile for non-political layers.
  - Consider producing two artifacts:
    - `political_topology.json` (interactive core)
    - `context_topology.json` (urban/physical/rivers optional lazy load)
  - Add build report that records file size, arc count, and geometry counts per profile.
- Complexity: Medium
- Risks:
  - Over-quantization can cause boundary drift and micro-gaps.
  - Preset border aesthetics may regress if simplification is too aggressive.

## Phase 4: Interaction Engine Upgrade (Hidden Color Map Picking)
- Goal: eliminate expensive hover/click hit tests at scale.
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
- Changes:
  - Activate `drawHidden()` in render lifecycle (only when dirty).
  - Read one pixel from `hitCanvas` for hover/click lookup.
  - Keep quadtree+`geoContains` as fallback path behind a flag.
  - Invalidate hit canvas only when transform/colors/data change.
- Complexity: Medium
- Risks:
  - DPR and transform mismatch can produce wrong picks if not aligned exactly.
  - Extra offscreen draw cost if invalidation policy is too broad.
  - Must preserve current hover tooltip correctness.

## Phase 5: Canvas Render Hot-Path Optimization
- Goal: stabilize 60fps zoom/pan with large datasets.
- Files:
  - `js/core/map_renderer.js`
  - `js/core/state.js`
- Changes:
  - Precompute per-feature projected bounds once after fit, reuse for culling.
  - Precompute visible feature ID lists by zoom band and viewport buckets.
  - Split render modes:
    - During active pan/zoom: cheap transform/blit strategy or reduced-detail draw.
    - On zoom end/idle: full-quality redraw.
  - Optional: move static context layers (urban/physical/rivers) to separate cached offscreen canvas and redraw only when toggles change.
- Complexity: High
- Risks:
  - Cache invalidation bugs can show stale colors after paint/autofill.
  - Could break "Auto-Fill" visual immediacy if redraw deferral is too aggressive.
  - More code complexity around transform-state coherence.

## Phase 6: Hierarchy/UI Synchronization for Subdivision Metadata
- Goal: ensure enriched grouping fields drive sidebar grouping without geometry replacement.
- Files:
  - `init_map_data.py`
  - `map_builder/geo/topology.py`
  - `tools/generate_hierarchy.py`
  - `js/main.js`
  - `js/ui/sidebar.js`
- Changes:
  - Keep detailed geometry IDs untouched.
  - Ensure `admin1_group` is persisted in political properties.
  - Generate hierarchy groups from `admin1_group` for configured subdivision countries.
  - Validate sidebar grouping by code prefix and label.
- Complexity: Medium
- Risks:
  - Group generation drift if country code normalization differs (GB vs UK).
  - Existing custom presets may overlap with generated group definitions.

## Delivery Strategy
- Iteration order:
  - Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6
- Gate each phase with hard checks:
  - Geometry count parity for protected countries.
  - Payload size budget.
  - Hover/click correctness.
  - Frame-time targets at representative zoom levels.

## Suggested Success Criteria
- Build-time:
  - `europe_topology.json` reduced from current baseline by 25-45% without losing required IDs.
- Runtime:
  - Panning stays smooth (>50fps target on representative hardware).
  - Hover latency under 16ms at normal zoom interaction.
  - No regression in Auto-Fill, preset apply, or hierarchy grouping.
