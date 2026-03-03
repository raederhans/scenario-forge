# 012 Architecture Audit — Codebase Health Check

Date: 2026-01-29

Scope
- Backend: `init_map_data.py`, `tools/*.py`
- Frontend: `js/app.js`, `index.html`
- Data pipeline: `data/` inputs/outputs and hierarchy linkage

---

## Section 1: Critical Issues (Things that will break or cause bugs soon)

1) Hierarchy → Topology mismatch for Russia ADM2 (already present)
- `tools/generate_hierarchy.py` builds RU groups from the full ADM2 dataset, while `init_map_data.py` **keeps only ADM2 west of the Urals** and swaps RU east to Admin‑1.
- Current data shows **736 RU_RAY_ IDs in `hierarchy.json` that do not exist in `europe_topology.json`** (hierarchy has 2327 RU_RAY_ children; topology has 1591 RU_RAY_ features).
- Impact: hierarchy group actions silently no‑op for those regions, users see incomplete coloring, and stored presets become misleading.

2) Source drift risk (unversioned raw data + schema‑dependent parsing)
- All replacement sources are fetched from moving URLs (GitHub `main`, Natural Earth S3) and parsed by expected column names.
- `apply_china_replacement()` dynamically selects ID/name columns; `generate_hierarchy.py` assumes `shapeID`. A source schema change would **silently diverge IDs** between hierarchy and topology.
- Impact: presets and hierarchy groups break without obvious errors; IDs may no longer match `europe_topology.json`.

3) Cache poisoning / stale cache failure mode
- `fetch_or_load_geojson()` writes raw bytes to `data/*.geojson` and treats the file as authoritative on subsequent runs.
- If a download is interrupted or returns HTML (rate limit / 403), the cache becomes invalid and the pipeline **fails on every run until the file is manually deleted**.
- Impact: brittle rebuilds; pipeline failure in CI or on fresh machines.

4) cntr_code derivation is fragile for Admin‑1 extensions
- `build_extension_admin1()` assigns IDs from Natural Earth (often numeric or `RUS-####`), then `extract_country_code()` tries to infer ISO from the ID. If it fails, a spatial join against borders is used.
- If `borders` lacks a usable ISO column (or spatial join fails), `cntr_code` remains null.
- Impact: palette application by country code (`applyCountryColor`) and UI grouping can silently fail.

---

## Section 2: Refactoring Roadmap (Backend / Pipeline Structure)

### A) Split `init_map_data.py` into a pipeline package
Current file is ~1,274 lines and mixes: network IO, CRS handling, replacement logic, topology build, and preview rendering.

Proposed layout:
```
map_pipeline/
  config.py               # URLs, bounds, tolerances, country lists
  io/
    fetch.py               # network + cache + validation
    cache.py               # checksums, manifest, invalidate logic
  processors/
    base.py                # clip/simplify/round helpers
    islands.py             # smart_island_cull, despeckle
  replacements/
    france.py
    poland.py
    china.py
    russia_ukraine.py
  outputs/
    preview.py             # preview rendering
    topology.py            # TopoJSON build
  main.py                  # orchestration only
```

### B) Unify tooling with pipeline modules
- `tools/generate_hierarchy.py`, `tools/scout_russia.py`, `tools/inspect_hierarchy_fields.py` re‑implement URL lists and CRS checks.
- Move shared utilities into `map_pipeline/` and import them, so the hierarchy builder **uses the same filters and IDs** as the main pipeline.

### C) Centralized configuration + versioning
- Introduce `config.py` and a `data/manifest.json` with:
  - source URL
  - expected hash (sha256)
  - date fetched
  - schema version notes
- This prevents silent drift and makes rebuilds reproducible.

---

## Section 3: Data Optimization (Attributes, IDs, Versioning)

### 1) ID standardization and metadata
- Adopt a single schema: `ISO2_{LEVEL}_{SOURCEID}` (e.g., `RU_ADM2_<shapeID>`, `FR_ARR_<code>`, `CN_ADM2_<shapeID>`).
- Add properties: `source`, `adm_level`, `source_id`.
- Benefits: prevents collisions, makes debugging and cross‑dataset linking reliable, improves UI filtering.

### 2) Make hierarchy generation topology‑aware
- Filter RU ADM2 by the same `URAL_LONGITUDE` rule before grouping.
- Optionally add a second set of RU groups for east‑of‑Urals Admin‑1 IDs, so hierarchy controls remain complete.
- Add a validation step: **fail build if any hierarchy child IDs are missing from topology**.

### 3) Separate raw vs processed data
Suggested structure:
```
data/
  raw/           # downloaded sources, pinned + checksummed
  cache/         # transient downloads
  processed/     # europe_topology.json, preview.png
  manifest.json
```
- Consider DVC or Git LFS for large raw datasets; keep only processed outputs in git.

### 4) Attribute cleanup
- Drop unused properties early (pre‑TopoJSON) to cut output size.
- Normalize `name` fields (trim, de‑duplicate, consistent language source) to reduce locale drift.

---

## Section 4: Frontend Componentization Plan (Breaking up `app.js`)

### A) State Management
Problem:
- `app.js` uses dozens of file‑scope globals (`selectedColor`, `currentTool`, `zoomTransform`, `colors`, `showUrban`, etc.).
- `window.currentLanguage` and other globals leak into the global namespace.

Plan:
- Introduce a simple state module with a single source of truth:
  - `state.js`: `getState()`, `setState(patch)`, `subscribe(listener)`
- Move transient UI state (hoveredId, editingPresetIds) into the store.

### B) Separation of Concerns
Suggested module split:
```
js/
  core/state.js
  core/data_loader.js      # TopoJSON + locales + hierarchy
  core/map_engine.js       # projection, render, caches
  core/hit_test.js         # quadtree / feature picking
  ui/ui_manager.js         # DOM + event wiring
  ui/presets.js            # presets + localStorage
  ui/i18n.js               # translations
  app.js                   # bootstrap only
```

### C) Render Loop Performance (redundant work still present)
Findings:
- `renderColorLayer()` loops **twice** over `landData.features` with the same culling logic.
- `boundsPath.area(feature)` is recomputed every render; this is expensive on large feature sets.
- Physical / urban / rivers are redrawn on every render even when toggles and zoom are unchanged.

Improvements:
- Precompute feature bounds + area once (store in `landIndex` or a parallel cache).
- Merge the two land loops into a single pass: compute base fill + optional color fill.
- Use offscreen caches for static layers (physical/urban/rivers) and redraw only on zoom or toggle changes.
- Make `drawHover()` part of a small overlay layer (cleared separately) to avoid “ghost highlight” artifacts.

---

### Closing Notes
- The pipeline is functional and already robust in many places (defensive CRS handling, fallback URLs, and mesh caching in the renderer).
- The **biggest immediate risk** is data linkage drift between hierarchy and topology; fixing that will prevent UI regressions and protect future RU/UA refinements.
