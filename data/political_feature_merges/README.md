# Political feature merges

Merged political features replace several adjacent source parcels with one
editable feature in **every** scenario and in the shared base data.

| File | Role |
| --- | --- |
| `europe_de_fr.candidates.json` | Input: adjacent DE NUTS-3 / FR arrondissement candidates from the 2026-10-21 granularity research. |
| `europe_de_fr.v1.json` | Applied plan: 54 groups, 132 members, 78 features removed. |
| `cn_us_ua_first_review.candidates.json` | Input: first-review dense-country candidates (Hebei, Henan, Anhui, Jiangxi; Texas; central Ukraine) from the 2026-10-21 TNO granularity research. |
| `cn_us_ua_first_review.v1.json` | Applied plan: 141 groups, 335 members, 194 features removed. |

Plans are applied one after another; their member sets are disjoint, and every
consumer (quick-fill, tests) reads all `*.v<N>.json` plans.

## Deriving the plan

`python tools/build_political_feature_merge_plan.py` keeps a candidate's members
together only where every scenario assigns them identically:

- owners and cores in `hoi4_1936`, `hoi4_1939`, `modern_world`, `tno_1962`;
- HOI4 strategic-value buckets (HOI4 states) in both HOI4 scenarios;
- `hierarchy.json` groups and every quick-fill level (e.g. French departments);
- the China prefecture crosswalk
  (`data/quick_fill/china_prefecture_crosswalk.v1.json`), including provinces
  not yet released to quick-fill, so county merges never cross a prefecture.
  Unresolved leaves only merge with other unresolved leaves;
- parents and contour supports of reviewed river-paint packs
  (`data/river_partitions/*.json`) are never merged, because their geometry
  fingerprints are part of each approved pack identity.

Inconsistent candidates are split into the largest consistent subsets that are
still contiguous; singletons stay unmerged. Merged IDs are
`<country>_MRG_<sha256(sorted members)[:12]>`, so ID-based country fallbacks
still resolve. Names join the members' names (`en` with ` + `, `zh` with `、`),
taken from `locales.json`, then scenario `geo_locale_patch.json` files (which
name leaves whose raw names are ambiguous), then the source topology name.

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
  cities, urban areas and releasable catalogs. The China prefecture crosswalk
  is projected and its input signatures re-pinned to the merged leaves. Scenario-specific names, such as
  TNO's, are composed from that scenario's own member names;
- population features (`--population-only`, run after the scenarios).
  Population and area are summed and fractions are area-weighted; each document
  is re-bound to its new topology hash and re-registered;
- `data/manifest.json` evidence (`sha256`, `size_bytes` and counts) for every
  output it changed that was in sync beforehand. The repository-footprint CI
  check rejects stale evidence for managed assets such as
  `europe_topology.na_v2.json`.

The projector raises on any conflicting many-to-one value and on any ID list
that contains only part of a group, except per-feature annotations (`audit`
samples and reviewed name collisions), where a lone merged member is valid.
Quick-fill metadata in `hierarchy.json` is then rebuilt from the projected
crosswalk and every applied plan.

Afterwards:

1. Regenerate the political ID raster assets with
   `node tools/build_political_id_raster_assets.mjs --base-url <dev server>/app/`
   and again with `--extend true`.
2. Re-pin the Modern World river-paint packs with
   `python tools/repin_river_partition_packs.py`. The new topology bytes and
   owner baseline change each pack's `source` (`landDigest`, `baselineHash`).
   The script rebuilds every pack from its own recorded rivers, parents and
   lake option, refuses any change to `parents` or `support`, regenerates the
   `.transport.json` downloads, and replaces each `packId` and
   `canonicalSha256` in `js/core/river_paint/pilot_manifest.js` (and its dist
   mirror when it was in sync).
3. Re-pin `scenario.baselineHash` in `landing/assets/sample-projects/*` and
   their `dist/assets` mirrors to each scenario manifest's new `baseline_hash`.
4. Regenerate the landing hero maps with
   `python tools/build_landing_europe_1936_showcase.py`; their metadata counts
   scenario features. Copy the changed files to `dist/assets` and update their
   `size_bytes` (plus `total_bytes` and the `assets` directory total) in
   `dist/pages-dist-manifest.json`.
5. Regenerate the landing map stage with
   `python tools/build_landing_history_scrubber.py`; it cuts the HOI4 1936,
   HOI4 1939, TNO 1962 and Modern World political features into shared pieces.

## After upstream rebuilds

Any rebuild that regenerates these assets from upstream sources restores the old
parcels. Run the apply tool (then population and rasters) again.
`tests/political_feature_merges_contract.test.mjs` fails while any runtime asset
still contains a merged-away ID.
