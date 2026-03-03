# QA-041 Interaction Correctness And Border Alignment Fix

Date: 2026-03-03
Project: Map Creator
Scope: phase-2 correctness slice for clear-map semantics, hit-test stability, ocean hover rejection, and data-contract hardening.

## Summary
This slice fixed three user-visible regressions and one build-contract hole:

1. `Auto-Fill Countries` followed by `Clear Map` now actually clears all visible fill state in visual mode.
2. Country/coastline mesh generation now follows the active composite/detail political source instead of staying pinned to primary-only topology.
3. Ocean and blank-space hover/click no longer resolve to bogus regions caused by world-bounds polygon interpretation.
4. Strict validation now checks the runtime-equivalent normalized geometry path, and the detail build performs a topology round-trip repair before final write.

## Root Cause
### 1. Clear Map regression
`Auto-Fill Countries` writes to `countryBaseColors` and `sovereignBaseColors`, while the old clear path only removed `visualOverrides` and `featureOverrides`.

### 2. False ocean hits / remote double-selection
A subset of detail polygons were interpreted by D3 spherical geometry as whole-world features. The worst earlier example was `US_ZN_26_002`, but the remaining failures were broader and came from polygon ring winding plus post-topology round-trip distortion.

### 3. Border mismatch
`rebuildStaticMeshes()` was still building global country/coast meshes from primary topology even when the visible land source was composite/detail.

## Implemented Changes
### Runtime / frontend
- `js/ui/toolbar.js`
  - visual-mode clear now resets `state.colors`, `state.countryBaseColors`, `state.sovereignBaseColors`, `state.visualOverrides`, and `state.featureOverrides`
- `js/core/state.js`
  - added spherical diagnostics cache
- `js/core/map_renderer.js`
  - proper ring rewinding: exterior clockwise, holes counterclockwise
  - invalid spherical features rejected from hover/click and hit-canvas
  - hover default snap reduced to `0px`; click snap reduced to `3px`
  - tooltip text now clears when hover clears
  - global country/coast meshes now use the active political source in composite mode

### Build / validation
- `tools/build_na_detail_topology.py`
  - detail political layer now performs a topology round-trip repair before final output write
- `tools/build_runtime_political_topology.py`
  - retained polygon validity/winding normalization in runtime political build
- `init_map_data.py`
  - topology validation now records both normalized and raw world-bounds counts
  - strict mode fails only on normalized world-bounds failures
  - manifest includes normalized and raw counts for diagnostics

## Validation Commands
```powershell
python init_map_data.py --mode detail
python init_map_data.py --mode i18n --strict
```

## Validation Results
### Build
- `python init_map_data.py --mode detail`
  - exit code `0`
- `python init_map_data.py --mode i18n --strict`
  - exit code `0`

### Key validation lines
```text
[Detail patch] Output political features: 11106
[Runtime Political] OK: wrote ...\europe_topology.runtime_political_v1.json (11135 features)
[Validate] europe_topology.json: ids=199, duplicates=0, missing_names=0, illegal_ids=0, world_bounds=0, raw_world_bounds=0
[Validate] europe_topology.na_v2.json: ids=11106, duplicates=0, missing_names=0, illegal_ids=0, world_bounds=0, raw_world_bounds=46
[Validate] europe_topology.runtime_political_v1.json: ids=11135, duplicates=0, missing_names=0, illegal_ids=0, world_bounds=0, raw_world_bounds=48
[Validate] hierarchy.json: children=8759, missing_from_europe_topology.runtime_political_v1.json=0
[Validate] geo_aliases.json: conflicts=0
```

Interpretation:
- normalized runtime-equivalent world-bounds failures are now `0`
- raw topology still contains `46` / `48` winding-sensitive cases, but the frontend/runtime normalization path neutralizes them and strict mode now evaluates the same geometry semantics used in the app

## Browser Regression Check
Target URL:
- `http://127.0.0.1:8000/?render_profile=full`

### Console errors/warnings
- blocked external font request to Google Fonts
- one synthetic Playwright evaluation error from an earlier inspection helper, not from app runtime logic
- no app-side data load failures after final reload

### Network failures / 4xx / 5xx
- only Google Fonts requests failed due client blocking
- all app JS and data files loaded with `200 OK`

### Screenshot
- `C:\Users\Public\Documents\Wondershare\CreatorTemp\mapcreator-phase2-fix-validation.png`

### Reproduction checks
1. Reload app with `?render_profile=full`
2. Move pointer to a projection-derived Atlantic ocean point
3. Confirm `hoveredId === null`, tooltip opacity `0`, tooltip text empty
4. Click same ocean point
5. Confirm no fill state changed
6. Click projected centroid of `US_ZN_02_001`
7. Confirm exactly one feature entered `state.colors`
8. Click `Auto-Fill Countries`, then `Clear Map`
9. Confirm `countryBaseColors = 0`, `sovereignBaseColors = 0`, `colors = 0`

### Observed results
- ocean hover: `hoveredId = null`, tooltip hidden, tooltip text empty
- ocean click: no color writes, no country fill writes
- land click on `US_ZN_02_001`: exactly one feature colored, no remote double-hit observed
- auto-fill then clear: color state fully reset

## Remaining Notes
- The raw topology still contains winding-sensitive polygons. This no longer breaks runtime interaction, but it remains a useful diagnostic metric.
- Detail political feature count dropped from `11120` to `11106` after round-trip repair. This is expected from removing unrecoverable or invalid round-trip geometries.
- Console still shows blocked Google Fonts requests. This is unrelated to map correctness.

## Next Phase Goals
1. Dirty-rect redraw for single-fill, country-fill, and batch sovereignty updates.
2. Explicit cache split: base land/ocean, political fill, borders, hit canvas, overlay.
3. Performance instrumentation for first paint, detail promote, hover latency, click latency, fill latency, and border recompute latency.
4. Optional follow-up: reduce raw winding-sensitive topology counts at the source so non-normalizing consumers also see `0` raw world-bounds cases.
