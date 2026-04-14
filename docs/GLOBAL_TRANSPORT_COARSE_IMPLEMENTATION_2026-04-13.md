# GLOBAL TRANSPORT COARSE IMPLEMENTATION 2026-04-13

## Goal
- Start phase A of global coarse transport implementation.
- Build checked-in static backbone products for global road and rail from Overture single-source inputs.
- Keep startup bundle / scenario chunk / workbench data chains untouched.

## Checklist
- [x] Start implementation tracker
- [x] Add shared Overture transport access helper
- [x] Add `global_road` builder, recipe, and package wiring
- [x] Add `global_rail` builder, recipe, and package wiring
- [x] Add minimal static/runtime scaffolding for future main-map integration
- [x] Add tests for builder/contract skeleton
- [ ] Run real builder outputs and check in formal manifests/audits/assets
- [ ] Archive this doc when phase A is fully complete

## Progress
- 2026-04-13 23:46: Started phase A implementation after confirming Overture S3 access works locally with PyArrow anonymous S3.
- 2026-04-13 23:58: Added `map_builder/overture_transport_common.py` to centralize Overture release/path access, row streaming, geometry decoding, simplification, and TopoJSON/GeoJSON writing helpers.
- 2026-04-14 00:03: Added `tools/build_global_transport_roads.py` and `tools/build_global_transport_rail.py` plus checked-in `source_recipe.manual.json` files under `data/transport_layers/global_road` and `data/transport_layers/global_rail`.
- 2026-04-14 00:06: Added package scripts for both global builders and minimal runtime scaffolding in `state/data_loader/main` for future deferred family loading.
- 2026-04-14 00:09: Added `tests/test_global_transport_builder_contracts.py`; validation passed with `python -m py_compile ...`, `python -m unittest tests.test_global_transport_builder_contracts -q`, and `node --check` on touched JS files.
- 2026-04-14 00:10: Phase A code skeleton is in place, but formal checked-in global manifests/audits/assets are still pending the first real builder run.
- 2026-04-14 00:24: Fixed road builder review blockers: road rows are now processed batch-by-batch into temporary parquet chunks before final assembly, and the empty `road_labels` path now returns a valid empty GeoDataFrame instead of crashing.
- 2026-04-14 00:25: Added regression coverage for empty road label generation and verified `build_roads_streaming(max_features=1)` completes without writing tracked outputs.
