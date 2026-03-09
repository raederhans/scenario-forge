# QA-077 TNO 1962 Atlantropa Mediterranean Close-Up Sweep (2026-03-09)

## Scope
- Scenario: `tno_1962`
- Goal: execute the Mediterranean close-up sweep plan on the existing Atlantropa cluster system without touching renderer/perf architecture.
- Allowed surface:
  - `tools/patch_tno_1962_bundle.py`
  - bundle rebuild outputs under `data/scenarios/tno_1962/`
- Out of scope:
  - Congo work
  - renderer changes
  - performance work
  - re-enabling `special_regions`
  - full Black Sea conversion

## Contract Kept
- `ATL land + ATL sea` remained the model.
- `scenario_water` still only contains `congo_lake`.
- `excluded_water_region_groups = ["mediterranean"]` stayed unchanged.
- Atlantropa sea was not downgraded back into macro `scenario_water`.

## Implemented Changes
### 1. `west_med` close-up tightening
- File: `tools/patch_tno_1962_bundle.py`
- Changes:
  - widened `sea_completion_bbox` slightly west/east for Gibraltar and Iberia-Algeria continuity
  - added control points for `8447` and `8454`
  - tightened `sea_preserve_margin`, `gap_fill`, `boolean_weld`, and `shore_seal`
- Intent:
  - improve Gibraltar / Alboran / Iberia-Algeria north coast close-up continuity
  - reduce coarse residual fragmenting without expanding into new systems

### 2. `libya_suez` shoreline and causeway tuning
- File: `tools/patch_tno_1962_bundle.py`
- Changes:
  - expanded `sea_completion_bbox`
  - added coastal control points for Tripoli / Cyrenaica / Alexandria side states
  - tightened `sea_preserve_margin`
  - increased `causeway_trim_width`
  - reduced `sea_drop_enclosed_max_area`
- Intent:
  - improve Tripoli-Benghazi-Alexandria-Suez shoreline continuity
  - keep `8572/8574` on the conditional-drop path rather than forcing Qattara in

### 3. `aegean` / Bosphorus / Black Sea mouth pass
- File: `tools/patch_tno_1962_bundle.py`
- Changes:
  - expanded `aoi_bbox` north-eastward for the strait chain
  - added Bosphorus-facing control points for `8531` and `8533`
  - increased `island_merge_distance`
  - added `major_island_groups` for `limnos`, `samothraki`, and `imbros`
  - narrowed `aegean.sea_completion_bbox` in a second pass to stop sea-completion spill into open Mediterranean
- Intent:
  - improve Dardanelles / Marmara / Bosphorus donor alignment
  - allow minimum Black Sea mouth north extension without reopening a full Black Sea job

### 4. Coastal-restore AOI expansion
- File: `tools/patch_tno_1962_bundle.py`
- Changes:
  - expanded `aegean` restore AOI
  - expanded `libya_suez` restore AOI
  - added `bosphorus_black_sea_mouth` restore AOI
- Intent:
  - keep shoreline recovery work local to the close-up sweep instead of adding new cluster families

### 5. Geometry normalization follow-up
- File: `tools/patch_tno_1962_bundle.py`
- Changes:
  - imported `orient` from `shapely.geometry.polygon`
  - updated `normalize_polygonal()` to orient every polygon part with the same winding convention used by the runtime topology builder
- Intent:
  - stop small completion polygons from being interpreted as inverted/complement fills during spherical rendering
  - align bundle-side polygon winding with `tools/build_runtime_political_topology.py`

## Build Results
Three meaningful rebuild states were observed in this round.

### Baseline before edits
- `west_med`: `hole_count = 15`, `pixel_fragments = 71`
- `libya_suez`: `hole_count = 16`, `pixel_fragments = 11`
- `aegean`: `hole_count = 42`, `pixel_fragments = 123`

### After first config pass
- bundle summary:
  - `Political features: 12678`
  - `ATL land features: 470`
  - `ATL sea features: 494`
- cluster diagnostics:
  - `west_med`: `30 / 37`
  - `libya_suez`: `29 / 7`
  - `aegean`: `86 / 102`
- interpretation:
  - fragment counts improved
  - hole counts regressed sharply, especially in `aegean`

### After narrowing `aegean.sea_completion_bbox`
- bundle summary:
  - `Political features: 12647`
  - `ATL land features: 470`
  - `ATL sea features: 463`
- cluster diagnostics:
  - `west_med`: `30 / 37`
  - `libya_suez`: `29 / 7`
  - `aegean`: `69 / 102`
- interpretation:
  - `aegean` hole count improved from the regressed state
  - central Mediterranean artifact still remained in browser evidence

### After polygon orientation normalization
- bundle summary:
  - `Political features: 12647`
  - `ATL land features: 466`
  - `ATL sea features: 467`
- cluster diagnostics:
  - `west_med`: `32 / 37`
  - `libya_suez`: `27 / 7`
  - `aegean`: `73 / 101`
- interpretation:
  - orientation normalization changed the loaded bundle hash and ATL geometry counts
  - `libya_suez` and `aegean` pixel/fragment state remained better than baseline
  - the large visible central block still did not pass visual acceptance

## Browser Evidence
### Console
- Browser verification found `0` errors and `0` warnings.

### Network
- All critical `tno_1962` bundle resources returned `200 OK`, including:
  - `manifest.json`
  - `countries.json`
  - `owners.by_feature.json`
  - `controllers.by_feature.json`
  - `cores.by_feature.json`
  - `water_regions.geojson`
  - `special_regions.geojson`
  - `relief_overlays.geojson`
  - `runtime_topology.topo.json`

### Screenshot set
- Baseline / first-pass evidence:
  - `tmp_pw/baseline-med-overview-zoom.png`
  - `tmp_pw/postbuild-med-overview-ownership.png`
  - `tmp_pw/postbuild-med-overview-frontline.png`
  - `tmp_pw/postbuild-west-med-ownership.png`
  - `tmp_pw/postbuild-libya-suez-ownership.png`
  - `tmp_pw/postbuild-bosphorus-ownership.png`
- Latest force-reloaded evidence on bundle hash `ccce423af77d...`:
  - `tmp_pw/postbuild3b-med-overview-ownership.png`

## What Improved
- `west_med` close-up sweep is materially better than baseline in the west-Med screenshot set.
- `libya_suez` fragment count improved from `11` to `7`.
- `aegean` fragment count improved from `123` to `101`.
- Browser-side verification confirms the scenario still loads cleanly and without console regressions.
- The bundle contract stayed intact while iterating only inside the TNO patch builder.

## What Did Not Pass
- Visual acceptance is still blocked by a large light-gray central/eastern Mediterranean block visible in:
  - `tmp_pw/postbuild-med-overview-ownership.png`
  - `tmp_pw/postbuild-med-overview-frontline.png`
  - `tmp_pw/postbuild2-med-overview-ownership.png`
  - `tmp_pw/postbuild3b-med-overview-ownership.png`
- The block changed shape across passes, which means the work narrowed the failure mode but did not fully remove it.
- Bosphorus / minimum Black Sea mouth verification is not yet sign-off ready because the overview failure remains ahead of final close-up acceptance.

## Investigation Notes
### First confirmed culprit
- A data inspection pass identified an earlier visible block as an ATL sea-completion polygon inside the `political` layer:
  - `ATLSEA_FILL_aegean_13`
  - `atl_surface_kind = sea`
  - `atl_geometry_role = sea_completion`
  - `region_id = aegean`
- That directly justified tightening the `aegean` completion envelope instead of broadening the cluster further.

### Later state
- After the later passes, the remaining block no longer cleanly mapped to the same earlier feature signature.
- Additional automated inspection showed only small numerical remaining holes by geometric area, which means the residual visible block is likely caused by one of:
  - a still-misdrawn completion polygon
  - an uncovered seam that does not present as a large polygonal hole in the simplified diagnostic reconstruction
  - a cluster-boundary interaction between `aegean` and `libya_suez`

## Qattara Status
- `Qattara` remained deferred in practice.
- `8572/8574` were kept on the conditional-drop path.
- This round did not attempt a forced Qattara bring-in because the main shoreline sweep still has unresolved Mediterranean acceptance blockers.

## Reproduction
1. Start the local dev server.
2. Rebuild the bundle with:
   - `./.venv-tno-build/bin/python tools/patch_tno_1962_bundle.py`
3. Open:
   - `http://127.0.0.1:8001/?render_profile=full`
4. Force-reload and apply `tno_1962`.
5. Verify in both `Ownership` and `Frontline`.
6. Compare the Mediterranean overview against the screenshot set above.

## Current Exit State
- This round implemented the planned config-layer sweep and one geometry-normalization follow-up.
- It achieved partial improvement and preserved runtime/bundle contracts.
- It did not yet achieve the final visual acceptance gate because the central/eastern Mediterranean block is still visible.
- The next round should target the remaining Mediterranean block directly with a feature-level diagnosis tied to the current `ccce423af77d...` bundle, not another broad parameter sweep.
