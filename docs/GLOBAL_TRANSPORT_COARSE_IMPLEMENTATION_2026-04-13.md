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
- [x] Rescope road v1 to staged backbone-first outputs
- [x] Rescope rail v1 to line-only phase A outputs
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
- 2026-04-14 16:31: Ran the first real full `build_global_transport_roads.py` trial. The process stayed active for more than two minutes, climbed to roughly 4 GB private memory, and still had not emitted the first formal output file. I stopped it after capturing the audit result: the builder no longer explodes immediately, but phase-A full-road finalize is still too heavy for confident formal generation.
- 2026-04-14 17:08: Road builder was restructured around a single normalized road chunk truth. Preview/full backbone assembly now runs serially from those chunks, preview was narrowed to motorway+trunk only, and full primary retention was tightened to high-value primary segments with refs and stronger reveal rank.
- 2026-04-14 17:14: Rail builder was rescaled to line-only phase A. It now streams into normalized rail chunks before serial preview/full assembly, while manifest/audit metadata explicitly mark `rail_stations_major` as phase-B placeholder rather than phase-A live capability.
- 2026-04-14 17:19: Added targeted builder contract regressions for road preview/full filtering and rail phase-A contract wording; runtime/UI/save-load gate remains intentionally closed until formal checked-in outputs exist.
- 2026-04-14 17:31: Tightened the road staged-output contract again: labels are now generated only after both preview/full backbones are written, and the checked-in road recipe no longer advertises a preview primary threshold.
- 2026-04-14 17:36: Added stronger guardrails for this phase boundary: tests now assert the single normalized chunk truth for roads, labels-after-backbone ordering, rail line-only manifest/audit payload shape, and that `showRoad/showRail` are still absent from live runtime/save-load files.
- 2026-04-14 17:07-17:08: Re-ran a real full `build_global_transport_roads.py` trial after the staged-output refactor. The process stayed active for about three minutes, reached roughly 3.1 GB private memory, and still emitted no formal checked-in outputs beyond the refreshed recipe file. This confirms the next blocker has narrowed to final materialization/TopoJSON assembly rather than the earlier multi-output batch fanout.
- 2026-04-14 17:11-17:13: Re-ran the full road build after tightening primary retention and adding phase logs. The builder still had not reached preview/full assembly when stopped, but logs now show it advanced through at least 500 normalized chunks (`raw_seen=441014`, `kept=54880`) before any checked-in output write. This means the next blocker is no longer “silent hang” but the still-heavy global normalize/spill pass before final assembly.
- 2026-04-14 17:18-17:22: Gave the road build a longer run after moving the primary cutoff earlier into normalization. The builder advanced to at least 1000 normalized chunks (`raw_seen=909045`, `kept=81938`) and roughly 3.86 GB private memory, but still never reached `starting preview backbone assembly` or emitted formal checked-in outputs. The current blocker is therefore the normalize/spill pass itself, not the later preview/full/labels staging.
- 2026-04-14 17:26-17:30: Reduced normalized chunk fanout by buffering roughly 5k kept features per parquet flush and narrowed road phase A to motorway+trunk only. This materially improved normalize throughput: the first ten flushed chunks now arrived by about `raw_seen=169938` instead of `raw_seen=408363`, while memory stayed around ~3.06 GB during that run. The build still did not reach preview assembly within the test window, so data prep is improved but not complete.
- 2026-04-14 17:39-17:42: Tried a more aggressive Arrow scanner prefetch/read-ahead tweak. It did not improve visible flush progress and instead drove private memory up to roughly 13.75 GB while still stuck before preview assembly, so the change was reverted immediately. The repository now remains on the safer chunk-buffering optimization only.
- 2026-04-14 17:47-17:50: Tightened road phase A further toward backbone-only outputs and re-ran the build. Even with motorway+trunk-only scope and chunk buffering, the build still only reached `normalized chunk 10 flushed` (`raw_seen=177638`, `kept=52570`) before memory climbed to roughly 4.99 GB, so final checked-in road outputs are still not ready. This confirms the remaining blocker is the geometry-heavy normalize/spill path itself, not preview/full/label staging.
- 2026-04-14 17:58: Implemented longitude-sharded road builder support using Overture `bbox` prefilter + bbox-center assignment, with shard outputs written under `data/transport_layers/global_road/shards/<shard_id>/...`.
- 2026-04-14 17:58:31: Verified the new shard path can produce formal outputs: shard `w180_w150` completed successfully and wrote `roads.preview.topo.json`, `roads.topo.json`, `manifest.json`, `build_audit.json`, and placeholder `road_labels` files into its shard directory.
- 2026-04-14 17:59-18:02: Tested a much denser shard (`e000_e030`). Even with sharding, that shard still stalled in normalize/spill before preview assembly, reaching only `normalized chunk 1 flushed` (`raw_seen=71960`, `kept=5057`) while memory climbed to roughly 4.69 GB. This means the sharding direction is correct, but the Europe/Africa-west shard is still too coarse and needs finer subdivision before global road prep can be considered complete.
- 2026-04-14 18:14-18:23: Added density-aware finer shard support for roads, including fixed finer shard ids in Europe/East Asia plus custom `--lon-min/--lon-max/--shard-id` overrides for ad-hoc dense-region slicing.
- 2026-04-14 18:19:36: Verified custom dense shard `e010_e012` completes successfully and writes a full checked-in shard pack under `data/transport_layers/global_road/shards/e010_e012/`.
- 2026-04-14 18:23:31: Verified adjacent dense shard `e012_e014` also completes successfully, confirming the finer high-density shard strategy works at least for central Europe slices where the broader `e000_e030` shard previously failed.
- Current shard assignment rule is intentionally simple: each road segment is assigned by `bbox_longitude_center` to exactly one shard. This avoids duplicate features across shard packs, but it also means a very long road can cross a shard boundary while only existing in the shard that owns its bbox center.
- 2026-04-14 18:24-18:35: Continued the shard run and confirmed additional successful formal road shard outputs for `e000_e002`, `e002_e004`, `e014_e016`, and `e016_e018`, each writing full shard packs with preview/full roads, manifest, audit, and placeholder road-label sidecars.
- 2026-04-14 18:35+: Confirmed that the earlier broader shard `e010_e015` had also completed successfully once given enough time. The only clearly incomplete shard directory from the earlier coarse run was `e000_e030`, and that partial directory was removed to avoid mixing failed attempts with ready shard outputs.
- 2026-04-14 18:49-18:55: Replaced the earlier `w090_w080 / w080_w070 / w070_w060` western shards with finer 5° windows after `w085_w080` timed out as a single shard.
- 2026-04-14 18:55+: Verified `w080_w075` completes successfully as a 5° shard, while `w085_w080` remained too dense and required another split.
- 2026-04-14 18:17-18:19 and 18:21-18:23: Verified dense custom shards `w085_w082p5` and the fixed eastern-Europe/central-Europe shards can complete successfully, which confirms the western hotspot also responds to finer subdivision.
