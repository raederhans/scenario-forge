# 013 Refactoring Blueprint — Backend + Frontend Decomposition

Date: 2026-01-29

Scope
- Backend: `init_map_data.py` → structured package (`map_builder/`)
- Frontend: `js/app.js` → ES module architecture

Goals
- Reduce monolithic complexity without changing behavior.
- Make data pipeline stages testable and reusable.
- Preserve existing outputs (`data/*.json`, `preview.png`) and UI behavior.

---

## 1) Backend Refactoring Plan (map_builder/ package)

### Proposed package layout
```
map_builder/
  __init__.py
  config.py                # centralized config (import from root config or migrate)
  pipeline.py              # orchestration only (no heavy logic)

  io/
    __init__.py
    fetch.py               # requests + retry + mirror + JSON validation
    cache.py               # cache path helpers, invalidation, manifest (future)
    readers.py             # read_file wrappers, CRS checks

  geo/
    __init__.py
    crs.py                 # ensure_crs, to_wgs84, round_geometries
    clip.py                # clip_to_bounds, clip_to_europe_bounds, clip_to_land_bounds
    simplify.py            # simplify configs, smart_island_cull, despeckle
    topology.py            # build_topology + validation
    preview.py             # preview image rendering

  processors/
    __init__.py
    base.py                # shared helpers (pick_column, rep_longitudes)
    france.py              # apply_holistic_replacements (FR)
    poland.py              # apply_poland_replacement
    china.py               # apply_china_replacement
    russia_ukraine.py       # apply_russia_ukraine_replacement + dateline clip
    extension_admin1.py    # build_extension_admin1 + balkan fallback

  outputs/
    __init__.py
    save.py                # save_outputs

  tooling/
    __init__.py
    hierarchy.py           # wrapper around tools/generate_hierarchy.py
    translations.py        # wrapper around tools/translate_manager.py
```

### Responsibility mapping (current → target)
- Download logic (`fetch_geojson`, `fetch_ne_zip`, `fetch_or_load_geojson`) → `map_builder/io/fetch.py`.
- CRS + geometry cleanup (`round_geometries`, `clip_to_*`, `smart_island_cull`) → `map_builder/geo/*`.
- Country replacements → `map_builder/processors/*`.
- Topology + preview output → `map_builder/geo/topology.py`, `map_builder/geo/preview.py`.
- Final pipeline orchestration (`main()` flow) → `map_builder/pipeline.py`.

### Dependency graph (no cycles)
- `pipeline.py` imports `io`, `processors`, `geo`, `outputs`, `tooling`.
- `processors/*` only import `geo` + `io` + `config` (never `pipeline`).
- `geo/*` only imports pure utilities + `config` (no `processors`).
- `tooling/*` only imports `tools` modules (thin wrappers).

This ensures all data flow is top‑down from `pipeline.py` and prevents circular imports.

---

## 2) Frontend Refactoring Plan (ES Modules)

### Proposed module layout
```
js/
  main.js                  # bootstrap + wiring
  core/
    state.js               # single source of truth (store + events)
    map_renderer.js        # pure D3 render pipeline
    data_loader.js         # load TopoJSON + locales + hierarchy
    hit_test.js            # quadtree + feature picking
  ui/
    sidebar.js             # country list + presets UI
    toolbar.js             # tool buttons + palette + export
    i18n.js                # translations + toggle
  util/
    dom.js                 # small DOM helpers (optional)
```

### State boundaries
- `state.js`: owns `currentTool`, `selectedColor`, `zoomTransform`, `colors`, `toggles`, `presets`, `language`, and derived caches.
- `map_renderer.js`: **pure render**. Accepts state snapshot and renders; no DOM.
- `sidebar.js` / `toolbar.js`: only DOM event binding + dispatch state updates.

### Index migration strategy
- Replace current script tag with module entry:
  - `index.html`: `<script type="module" src="js/main.js"></script>`
- Temporary compatibility:
  - In `main.js`, expose minimal globals during transition (e.g., `window.debugState = state`), then remove later.
- Convert D3 + topojson imports:
  - Use CDN ES builds or import via `import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'` and `import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm'`.

---

## 3) Execution Steps (Safe Migration Path)

### Backend
1) **Create package skeleton** (`map_builder/`) and move low‑risk helpers:
   - `pick_column`, `ensure_crs`, `round_geometries`, `clip_to_*`.
2) **Extract IO layer**:
   - Move `fetch_or_load_geojson`, `fetch_ne_zip`, mirror logic to `map_builder/io/fetch.py`.
3) **Split processors**:
   - Create `processors/france.py`, `poland.py`, `china.py`, `russia_ukraine.py`.
   - Keep signatures identical; update imports.
4) **Extract output generation**:
   - Move `save_outputs` and `build_topology` into `map_builder/outputs/` + `geo/topology.py`.
5) **Replace `main()`** with a thin orchestrator in `map_builder/pipeline.py`.
6) **Keep init_map_data.py as a wrapper** (backward compatibility):
   - `from map_builder.pipeline import run` and call it.

### Frontend
1) **Create `state.js`** and move state variables + setters.
2) **Move render functions** into `core/map_renderer.js` (no DOM access).
3) **Extract data loading** into `core/data_loader.js` (fetch TopoJSON + locales + hierarchy).
4) **Split UI**:
   - `ui/sidebar.js`: country list + preset tree + search.
   - `ui/toolbar.js`: palette + tool selection + export + layer toggles.
5) **Create `main.js`** to wire imports, initialize state, and register UI.
6) **Update `index.html`** to load `main.js` as module and remove old script tag.

---

## Notes / Guardrails
- Maintain output parity: `data/europe_topology.json`, `data/hierarchy.json`, `data/locales.json` should be unchanged.
- Keep `tools/*.py` as standalone scripts; call them via wrappers in `map_builder/tooling`.
- Avoid breaking `start_dev.bat`: keep `init_map_data.py` as a CLI entry during migration.
