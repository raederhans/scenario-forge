# Political feature merges

Merged political features replace several adjacent source parcels with one
editable feature in **every** scenario and in the shared base data.

| File | Role |
| --- | --- |
| `europe_de_fr.candidates.json` | Input: adjacent DE NUTS-3 / FR arrondissement candidates from the 2026-10-21 granularity research. |
| `europe_de_fr.v1.json` | Applied plan: 54 groups, 132 members, 78 features removed. |

## Deriving the plan

`python tools/build_political_feature_merge_plan.py` keeps a candidate's members
together only where every scenario assigns them identically:

- owners and cores in `hoi4_1936`, `hoi4_1939`, `modern_world`, `tno_1962`;
- HOI4 strategic-value buckets (HOI4 states) in both HOI4 scenarios;
- `hierarchy.json` groups and every quick-fill level (e.g. French departments);
- parents and contour supports of reviewed river-paint packs
  (`data/river_partitions/*.json`) are never merged, because their geometry
  fingerprints are part of each approved pack identity.

Inconsistent candidates are split into the largest consistent subsets that are
still contiguous; singletons stay unmerged. Merged IDs are
`<country>_MRG_<sha256(sorted members)[:12]>`, so ID-based country fallbacks
still resolve. Names join the members' names (`en` with ` + `, `zh` with `、`).

## Applying the plan

`python tools/apply_political_feature_merges.py` rewrites:

- base topologies `europe_topology.na_v2.json` and
  `europe_topology.runtime_political_v1.json`, and every scenario runtime
  topology. Geometries are merged with shared arcs and verified to equal the
  exact union of their members; all other geometries stay identical;
- scenario sidecars through `tools.materialize_polar_scenarios.refresh_scenario`,
  which delegates chunks, startup bundles and snapshots to the scenario contract
  builder;
- `hierarchy.json`, `locales.json`, `geo_aliases.json`, country policies,
  cities, urban areas and releasable catalogs. Scenario-specific names, such as
  TNO's, are composed from that scenario's own member names;
- population features (`--population-only`, run after the scenarios).
  Population and area are summed and fractions are area-weighted; each document
  is re-bound to its new topology hash and re-registered.

The projector raises on any conflicting many-to-one value and on any ID list
that contains only part of a group.

Afterwards:

1. Regenerate the political ID raster assets with
   `node tools/build_political_id_raster_assets.mjs --base-url <dev server>/app/`
   and again with `--extend true`.
2. Re-pin the Modern World river-paint packs. The new topology bytes and owner
   baseline change each pack's `source` (`landDigest`, `baselineHash`), so
   rebuild every `modern_world_*.json` with `tools/build_river_partitions.py`
   (same rivers, parents and lake option as its `source`, plus the new
   `--baseline-hash`). Confirm `parents` and `support` are byte-identical to
   the reviewed pack. Then regenerate the `.transport.json` downloads with
   `tools/river_partitions/compact_transport.py`, and replace each pack's
   `packId` and `canonicalSha256` in `js/core/river_paint/pilot_manifest.js`.
   The canonical hash is the SHA-256 of `JSON.stringify(normalizeRiverPartitionPack(pack))`.
3. Re-pin `scenario.baselineHash` in `landing/assets/sample-projects/*` and
   their `dist/assets` mirrors to each scenario manifest's new `baseline_hash`.

## After upstream rebuilds

Any rebuild that regenerates these assets from upstream sources restores the old
parcels. Run the apply tool (then population and rasters) again.
`tests/political_feature_merges_contract.test.mjs` fails while any runtime asset
still contains a merged-away ID.
