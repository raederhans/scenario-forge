# TNO 1962 Province Voids Context

## 2026-04-29 Start
- Loaded project rules, Ralph, Ultrawork, Browser, and systematic debugging guidance.
- Existing plan-mode investigation found root causes for Russia Arctic and northern Pakistan naming.
- Current repo status was clean at execution start.
- Disposable water validator report exists under `.runtime/reports/generated/tno_water_geometry_report.json`.

## Working Notes
- Use root-cause repair only; avoid broad fallback layers.
- Main thread owns live tests and browser checks.
- Subagents may do static analysis and focused review.

## 2026-04-29 Implementation Pass
- `patch_tno_1962_bundle.py` now pulls Arctic shell fragments from the full base runtime topology.
- `map_renderer.js` now lets shell fragments render visually while keeping them out of interaction targets.
- Northern Pakistan `DATA NOT AVAILABLE` is handled through `geo_name_overrides.manual.json`.
- Kyzylorda interior hole is converted into a scenario water feature sourced from `KAZ-3197` geometry.
- Focused unit checks for shell extraction, manual locale override, chunk shell behavior, and renderer contracts passed before bundle rebuild.

## 2026-04-29 Verification Pass
- Published runtime has 76 `RU_ARCTIC_FB_*` shell features, 9,567 source Arctic fragments, and about 90.3% retained source area after coalescing.
- Startup bootstrap and regenerated startup bundles both preserve the 76 Arctic shell features as non-interactive political visual geometry.
- `tno_qyzylorda_inland_water` is present in `runtime_topology.topo.json`, `water_regions.geojson`, chunk water outputs, and the water geometry validator probe.
- `IN_ADM2_76128533B2782141712775` resolves through the locale patch as `Northern Areas` / `北部地区`.
- Browser startup check on `127.0.0.1:8000/app/` loaded `tno_1962` with no failed network requests and exposed the 76 startup shell features.
- Focused Shapely coverage probes found zero `land - (political union + water union)` area for Somalia horn, Suriname, and southern Uganda bboxes. These are not confirmed missing-province data holes in the current checked-in geometry.
- Direct startup bundle generation from published scenario data now succeeds and writes `.runtime/reports/generated/tno_1962.startup_bundle_report.json`; gzip size is about 1.27 MB per language.
- Full runtime topology rebuild remains memory-heavy in this workspace. The final publish used targeted checked-in data updates plus published-data startup regeneration.

## Test Log
- Passed: `python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_checked_in_tno_runtime_topology_has_clean_polar_features tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_runtime_topology_payload_preserves_tno_shell_helper_fields tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_tno_shell_features_coalesces_full_source_rows tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_qyzylorda_inland_water_feature_extracts_kaz_3197_hole -q`
- Passed: `python -m unittest tests.test_tno_geo_locale_patch -q`
- Passed: `python -m unittest tests.test_scenario_chunk_assets.ScenarioChunkAssetsTest.test_build_and_write_scenario_chunk_assets_preserves_helper_fields_and_writes_opening_owner_mesh -q`
- Passed: `node --test tests/scenario_chunk_contracts.test.mjs`
- Passed: `python tools/validate_tno_water_geometries.py`
- Passed: `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962 --strict --report-path .runtime/reports/generated/tno_1962.strict_contract_report.json`
- Passed: `python -m unittest tests.test_startup_bootstrap_assets.StartupBootstrapAssetsTest.test_tno_1962_checked_in_startup_bundle_includes_arctic_shell -q`
- Blocked by environment: `python -m pytest tests/test_tno_water_geometries.py -q` because this local Python has no `pytest`; the file is pytest-style and `unittest` discovers zero tests there.

## 2026-04-29 Shell Residual Closeout
- Static review found 18 legacy numeric `RU_ARCTIC_FB_*` shell features mixed into the new coalesced shell set. These rows had no `scenario_shell_owner_hint` or `scenario_shell_controller_hint`.
- `build_countries_stage_state()` now filters old runtime shell rows out of `runtime_owned_political_gdf` before `cut_political_features()` and before appending the coalesced shell output.
- `tools/check_scenario_contracts.py --strict` now rejects runtime-only Arctic shell features unless they are coalesced `shell_fallback` rows with owner/controller hints.
- `tools/scenario_chunk_assets.py` now preserves shell owner/controller hints in political coarse chunks.
- Full `runtime_topology` and `startup_support_assets` stages still climb to about 31-32 GB in this workspace, so they were stopped. The final checked-in data closeout used the clean `countries` checkpoint as the source of truth, then narrowly removed legacy shell rows from runtime/bootstrap/startup/chunk artifacts and refreshed startup gzip sidecars plus chunk manifest sizes.
- Current checked-in shell probe: `runtime_topology.topo.json`, `runtime_topology.bootstrap.topo.json`, and both startup bundles each have 58 Arctic shell features, 0 numeric legacy ids, 0 missing hints, and 9,549 source fragments.
- Current chunk probe: `political.coarse.r0c0.json` has 58 Arctic shell features with hints; `political.detail.country.ru.json` has 58 Arctic shell features with hints; `political.detail.country.af.json` has 16 duplicated covered shell features with hints.

## Final Verification Addendum
- Passed: `python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_checked_in_tno_runtime_topology_has_clean_polar_features tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_validate_publish_bundle_dir_accepts_shell_fallback_runtime_only_features tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_validate_publish_bundle_dir_rejects_legacy_shell_runtime_only_features tests.test_startup_bootstrap_assets.StartupBootstrapAssetsTest.test_tno_1962_checked_in_startup_bundle_includes_arctic_shell tests.test_scenario_chunk_assets.ScenarioChunkAssetsTest.test_build_and_write_scenario_chunk_assets_preserves_helper_fields_and_writes_opening_owner_mesh tests.test_scenario_chunk_assets.ScenarioChunkAssetsTest.test_political_coarse_falls_back_to_runtime_topology_when_startup_shell_has_no_political -q`
- Passed: `node --test tests/scenario_chunk_contracts.test.mjs`
- Passed: `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962 --strict --report-path .runtime/reports/generated/tno_1962.strict_contract_report.json`
- Passed: `python tools/validate_tno_water_geometries.py`
- Passed: `python -m py_compile tools/patch_tno_1962_bundle.py tools/check_scenario_contracts.py tools/scenario_chunk_assets.py tools/build_startup_bootstrap_assets.py tools/build_startup_bundle.py`
