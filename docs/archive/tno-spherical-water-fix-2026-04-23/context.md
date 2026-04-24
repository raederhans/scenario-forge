# TNO spherical water fix context

## 2026-04-23

- Current HEAD is `ab5ca22`, after recent scenario and transport commits.
- Root cause evidence already established: D3 sees `tno_sea_of_marmara` part 12 as full-sphere, and large map clicks can hit Marmara.
- D3 also marks `tno_south_indian_antarctic_ocean` and runtime `land_mask/context_land_mask` as world-bounds.
- Shapely-only validation misses this class of bug, so tests must call D3 or an equivalent JavaScript probe.
- `omx_state` lifecycle write failed because the MCP transport closed; local task docs are the active state record for this run.

## Constraints

- Parent thread owns all live tests.
- Subagents perform static review or scoped implementation only.
- Avoid broad fallback layers; prefer one shared D3 spherical geometry contract used by renderer and tests.
- Keep checked-in temporary outputs under `.runtime/`.

## Execution Notes

- Renderer now uses D3 spherical diagnostics to sanitize water region parts before drawing, highlighting, coverage estimation, and spatial hit indexing.
- Ocean clip mask selection now rejects D3 world-bounds/oversized mask candidates and carries the mask quality token into render/cache version signatures.
- Builder output now prunes Marmara's tiny unsafe component, repairs South Indian Antarctic Ocean orientation, splits full-width mask geometry, and writes water/mask TopoJSON objects through D3-compatible arcs.
- Runtime data was repaired for source water, water chunks, runtime scenario water, runtime land/context masks, and AQ polar political chunks.
- Static final review found one performance issue in water rendering; it was fixed by restoring viewport culling per safe water part.
- Static final review also found a broader runtime political D3 winding issue. This task keeps the hard D3 gate scoped to water/masks and applies political D3 splitting only to AQ; full political winding cleanup remains a separate task.

## Verification

- `node --test tests/scenario_chunk_contracts.test.mjs` passed.
- `node --check js/core/map_renderer.js`, `node --check js/core/renderer/spatial_index_runtime_builders.js`, and `node --check js/core/renderer/spatial_index_runtime_owner.js` passed.
- `python -m py_compile tools/patch_tno_1962_bundle.py tools/validate_tno_water_geometries.py tests/test_tno_water_geometries.py` passed.
- `python tools/validate_tno_water_geometries.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_water_geometry_report.json` passed.
- `python -m unittest tests.test_tno_bundle_builder` passed.
- `python -c "import tests.test_tno_water_geometries as t; ..."` passed for 15 geometry tests; the existing manifest/startup timestamp assertion was skipped because it fails on HEAD before this task.
- `git diff --check` passed with only CRLF conversion warnings.
