# TNO Atlantropa Owner-Aware Interaction Context

## Findings

- `b2109d4` already moves TNO water regions to runtime topology and syncs secondary water/special indexes.
- Atlantropa land features still need `cntr_code=ATL` for runtime/chunk grouping.
- User-visible fill, hit result, country target resolution, and bulk fill should use the real owner from scenario metadata.
- `ATLISL_*` rows with `atl_join_mode=boolean_weld` are still interactive in checked-in TNO topology data.

## Progress

- Created active task docs.
- Patched renderer hit result and target resolution to use owner-aware `countryCode` while preserving `runtimeCountryCode`.
- Patched political background merge to filter non-interactive/support-helper features.
- Patched TNO builder and checked-in TNO runtime/chunk JSON so `ATLISL_*` `boolean_weld` rows are non-interactive.
- Extended renderer and TNO bundle contract tests.
- Verified `ATLISL_* boolean_weld` checked-in rows: runtime topology and both political chunks each have 11 rows, all `interactive=false`.
- Tests passed: `node --test tests/scenario_chunk_contracts.test.mjs`.
- `pytest` is unavailable in this environment, so the TNO bundle checks were run with `python -m unittest` for the three targeted test methods.
- Syntax checks passed: `node --check js/core/map_renderer.js`, `python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py`.
- Final reviewer found a visual/interaction conflation risk. Fixed by splitting visual exclude from interaction exclude, so `ATLISL_* boolean_weld` stays visible while leaving hit and batch target paths.
