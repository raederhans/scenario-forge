# Context

- 2026-04-23: Static analysis only. No tests, no rebuild.
- ATLISL rows are created in `make_atl_row()`. Default `cntr_code` is always `ATL`; default `interactive` depends on `geometry_role` plus `atl_join_mode`.
- `build_countries_stage_state()` appends ATL GeoDataFrame into `scenario_political_gdf`, then `rebuild_feature_maps_from_political_gdf()` emits owners/controllers/cores.
- `apply_tno_feature_assignment_overrides()` is the only TNO post-pass here that rewrites both owners/controllers/cores and `scenario_political_gdf["cntr_code"]` for listed ATLISL ids. `apply_tno_owner_only_backfill()` also rewrites `cntr_code`, but its current constant has no ATLISL entries.
- Runtime publish path keeps `interactive` and `cntr_code` via `build_runtime_topology_payload()`. Chunk publish then reads published runtime topology and groups political detail chunks by `cntr_code` in `tools/scenario_chunk_assets.py::_build_political_chunk_payloads()`.
- Current checked-in publish confirms the split: some ATLISL stay in `political.detail.country.atl.json` with `interactive=false`; override-listed ATLISL already land in `political.detail.country.ita.json`, `ibr.json`, or `tur.json` with owner-tag `cntr_code`.
