# Political feature merges

Merged political features replace several adjacent source parcels with one
editable feature in **every** scenario and in the shared base data, or only in
the scenarios a plan names (see *Scenario-scoped plans*).

| File | Role |
| --- | --- |
| `parent_names.json` | Reviewed bilingual parent names used by `parent_direction` naming. |
| `europe_de_fr.candidates.json` | Input: adjacent DE NUTS-3 / FR arrondissement candidates from the 2026-10-21 granularity research. |
| `europe_de_fr.v1.json` | Applied plan: 54 groups, 132 members, 78 features removed. |
| `cn_us_ua_first_review.candidates.json` | Input: first-review dense-country candidates (Hebei, Henan, Anhui, Jiangxi; Texas; central Ukraine) from the 2026-10-21 TNO granularity research. |
| `cn_us_ua_first_review.v1.json` | Applied plan: 141 groups, 335 members, 194 features removed. |
| `india_canada_first_review.candidates.json` | Input: India (regional variant over corrected state parents) and Canada (regional variant, minus two unions above 50,000 km²) candidates from the 2026-10-23 TNO granularity research. |
| `india_canada_first_review.v1.json` | Applied plan: 106 groups, 245 members, 139 features removed. |
| `europe_russia_wave3.candidates.json` | Input: Codex-reviewed UK, Czechia, Slovakia and Poland candidates (2026-10-21 Europe granularity research), southern/eastern France and the Moscow Reichskommissariat (RKM) parcels in TNO (2026-10-21 granularity pilot), and the remaining Ukraine candidates of the 2026-10-21 dense-country research except `UA_Kherson`, whose parent mixes Crimean source IDs. |
| `europe_russia_wave3.v1.json` | Applied plan: 271 groups, 655 members, 384 features removed. |
| `russia_china_wave4.candidates.json` | Input: Russia outside the Moscow Reichskommissariat, generated with the Codex protection engine under the RKM pilot rules, and the Codex 2026-10-21 v2 candidates for Shanxi, Shaanxi, Hunan, Guizhou and Guangxi. Groups whose union has a convex-hull fill below 0.4, an aspect above 3.5 or an area above 50,000 km² are left out. |
| `russia_china_wave4.v1.json` | Applied plan: 248 groups, 656 members, 408 features removed. |
| `benelux_wave5.candidates.json` | Input: Belgium and the Netherlands, two to three groups per province (provinces recovered from GISCO NUTS-2 and added to `hierarchy.json`). City hosts are protected for capitals, major cities and cities of at least 250,000. Applied to every scenario, because the shared HOI4 vanilla releasable catalog lists Flemish and Walloon parcels. |
| `benelux_wave5.v1.json` | Applied plan: 20 groups, 50 members, 30 features removed (Belgium 44 → 25, the Netherlands 40 → 29). |
| `germany_poland_wave5_{tno,rest}.candidates.json` | Input: Germany (HOI4-state level) and Poland (voivodeship level) from the 2026-10-25 central Europe research. City hosts are protected for capitals, major cities and at least 250,000 people; parcels of the shared historical display presets and candidates crossing a vanilla releasable boundary variant stay unmerged (written before presets and the vanilla catalog were projected per scenario). |
| `germany_poland_wave5_tno.v1.json` | Applied plan scoped to `tno_1962`: 54 groups, 272 members, 218 features removed. |
| `germany_poland_wave5_rest.v1.json` | Applied plan scoped to `blank_base`, `hoi4_1936`, `hoi4_1939`, `modern_world`: 48 groups, 173 members, 125 features removed. |
| `russia_wave5_{tno,rest}.candidates.json` | Input: Russia, P2 tier of the 2026-10-25 upper-level research (area caps 15,000 / 25,000 / 35,000 / 45,000 km² for European Russia / Urals / Siberia / Far East, convex-hull fill ≥ 0.4, aspect ≤ 3.5). City hosts are protected for capitals, major cities and at least 500,000 people; same-owner TNO neighbours no longer lock. |
| `russia_wave5_tno.v1.json` | Applied plan scoped to `tno_1962`: 282 groups, 1346 members, 1064 features removed. |
| `russia_wave5_rest.v1.json` | Applied plan scoped to `blank_base`, `hoi4_1936`, `hoi4_1939`, `modern_world`: 278 groups, 1011 members, 733 features removed. |
| `india_wave5_{tno,rest}.candidates.json` | Input: India, second round, division-level target of the 2026-10-25 research (area caps 12,000–45,000 km² by region). City hosts are protected for capitals, state capitals, major cities and at least 500,000 people; Ladakh, Jammu and Kashmir and Arunachal Pradesh stay locked. |
| `india_wave5_tno.v1.json` | Applied plan scoped to `tno_1962`: 95 groups, 368 members, 273 features removed. |
| `india_wave5_rest.v1.json` | Applied plan scoped to `blank_base`, `hoi4_1936`, `hoi4_1939`, `modern_world`: 90 groups, 351 members, 261 features removed. |

Plans are applied one after another in the order of `apply_order.json`, never
by file name; the plan tool appends each new plan there. Within each scenario
their member sets are disjoint, and every consumer (apply tool, quick-fill,
tests) reads the plans through that order. A later plan may list an earlier
merged feature (`*_MRG_*`) as a member: the plan IDs then chain (A, B → M1;
M1, C → M2), so replaying the plans in order after an upstream rebuild yields
the same result. The order is rejected when a merged member does not come
from an earlier plan that applies to every scenario of the later one.

### Scenario-scoped plans

`--scenarios tno_1962` (plan field `"scenarios"`) applies a plan only to those
scenarios. Owners, cores and HOI4 states come from those scenarios alone, and
contiguity must hold in each of them. A scope names both HOI4 scenarios or
neither. Hierarchy, quick-fill, China prefecture and every protection rule stay
global, except river-paint packs: they belong to one scenario (`sceneId`), so
only a scope that includes it protects their parcels. The plan tool refuses a candidate member that an applied plan already
merged away in any scenario of the new scope. The apply tool then:

- leaves the base topologies, `hierarchy.json` and the China crosswalk
  unchanged, and records the merges in each scoped scenario's
  `manifest.json` under `hierarchy_overrides.feature_merges`, from which
  `js/core/scenario_hierarchy.js` projects the shared hierarchy;
- adds merged entries to `locales.json` and `geo_aliases.json` while keeping
  the members' entries. In the scoped scenarios the members' aliases, and those
  of an earlier scoped merge (`hierarchy_overrides.feature_redirects`), name
  the merged feature: `js/core/scenario_localization_state.js` projects the
  scenario's alias view, startup and full alike, and leaves the shared
  (startup) alias map unprojected so other scenarios keep the members;
- projects a global file only when every scenario that reads it is in scope
  (the TNO releasable catalog for `tno_1962`; the HOI4 vanilla catalog for
  blank, both HOI4 scenarios and Modern World), leaves a file none of whose
  readers is in scope untouched, refuses a plan that touches a file read both
  inside and outside the scope, and leaves city host IDs on the members;
- except for the historical display presets (`country_feature_policies.json`
  `display.presets`) and the preset sources of the HOI4 vanilla releasable
  catalog and its source file (`preset_source.feature_ids` /
  `exclude_feature_ids`, also under `boundary_variants` and
  `companion_actions`): these keep the members, and
  `js/core/releasable_manager.js` projects them through the active scenario's
  `feature_merges` when it builds presets and resolves releasables. A merged
  feature counts only when a list names all of its members; a list naming only
  some drops them and logs the merged ID, so a preset never grows. The apply
  tool refuses a plan whose group is only partly in one of these lists, or
  whose members appear anywhere else in those files (for example
  `fragmentCamouflage`), before writing anything;
- rewrites population features of the scoped scenarios only.

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
- `political_precision_feature_ids` membership in every topology the apply
  tool rewrites (base topologies and each scenario runtime topology), so a
  merge never mixes precision and ordinary parcels;
- members must agree on every non-name topology property (for example a TNO
  parcel coded with its warlord tag instead of `RU`), because the merged feature
  keeps one property set;
- members whose geometry is invalid in any of those topologies are never
  merged, because the apply tool unions exact coordinates without repair;
- members must lie wholly inside or outside every shared ID list their
  scenarios read (historical display presets, releasable preset sources of the
  vanilla catalog and, for TNO, its own catalog); a scoped merged member takes
  its leaves' lists;
- features with their own `display.fragmentCamouflage` rule in
  `country_feature_policies.json` are never merged, since a merge would widen
  or drop that rule;
- parents and contour supports of reviewed river-paint packs
  (`data/river_partitions/*.json`) are never merged, because their geometry
  fingerprints are part of each approved pack identity.

Inconsistent candidates are split into the largest consistent subsets that are
still contiguous; singletons stay unmerged. Merged IDs are
`<country>_MRG_<sha256(sorted members)[:12]>`, so ID-based country fallbacks
still resolve.

Groups are named (`--naming parent_direction`, the default):

- after the largest city they host (`world_cities.geojson`, population at least
  `--city-min-population`, default 1,000,000);
- otherwise `<parent> · <direction>` / `<上级>·<方位>`, the compass sector
  (北部, 东北部, … 西北部, or 中部 near the centre) of the group's centroid
  around its parent's. A group covering its whole parent takes the parent's
  name, and repeated names in one parent are numbered by descending area.

The parent is the candidate's `parent_id` (or the one hierarchy group holding
every member). Its names come from the candidate's `parent_names`, then the
reviewed `parent_names.json` (`{"parents": {id: {en, zh}}}`), then an exact
`locales.json` match of the hierarchy label; a parent without a bilingual name
fails the plan. Member names (`member_names`) still join the members' names
from `locales.json`, then scenario `geo_locale_patch.json` files, then the
source topology name; they stay searchable as aliases. `--naming members`
keeps the older joined names (`en` with ` + `, `zh` with `、`).

### Representative names

`--naming representative` names a group after one place
(`name_source` and `representative_id` record which):

1. `city`: the most populous city the members host in `world_cities.geojson`
   whose `name_zh` is actually Chinese (a city without a Chinese name is skipped,
   so both languages name the same place);
2. `population`: otherwise the member with the largest population in the GHSL
   population layer;
3. `area`: when a member has no population, the member with the largest land area.

A scenario that translates the representative member itself (TNO's
`geo_locale_patch.json`) keeps its own name in `scenario_names.<scenario>`, but
only in the languages where it differs from the member's global name; a city
name follows the scenario only when it is the member's own name. The apply
tool writes those names into that scenario's files and the plan names
everywhere else.

Names must stay distinguishable within a country. A name (English
case-insensitive, or Chinese) that another feature of the same `cntr_code`
already uses, or that several groups receive, gets its parent in brackets:
`Name (Parent)` / `名称（上级）`, with parent names resolved as above
(`parent_names.json` holds the reviewed ones). Groups that still share a name
are numbered by descending population (`Name (Parent) 2`).

The plans listed in `apply_order.json` up to `russia_china_wave4.v1.json` were
renamed this way after they were applied:

```
python tools/build_political_feature_merge_plan.py --rename <plan> [<plan> ...]
python tools/apply_political_feature_merges.py --rename-only <plan> [<plan> ...]
```

`--rename` reads the members' cities, population and scenario names as they
were before the merge (the parent of the commit that added each plan, or
`--facts-ref`), keeps IDs and members, and stores the joined name as
`previous_names`. `--rename-only` projects the names with the same projector as
a merge, over each merged ID as its own member: `locales.json`,
`geo_aliases.json` (the joined names move to `search_only_aliases` and keep
their `alias_to_stable_key` entries), the topologies' `name` property, the
scenario patches and overrides, and then refreshes chunks, startup subsets and
bundles through `refresh_scenario`, re-binds the population documents to the
new topology bytes and refreshes the manifest evidence. Geometry, IDs and
owners do not change, but the topology bytes do, so run the downstream script
afterwards (with the last renamed plan, which covers every scenario).

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
  TNO's, are composed from that scenario's own member names for joined names;
  a parent/direction, city or representative name replaces every member's name
  (including an earlier merge's), and the members' names become `search_only_aliases`;
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

Afterwards, `python tools/refresh_political_feature_merge_downstream.py --plan <plan>
--base-url <dev server>/app/ --landing-python "<WSL python>"` runs these steps for
the plan's scenarios only (`--dry-run` lists them):

1. The political ID raster assets of the scoped HOI4 1936, HOI4 1939 and TNO 1962
   scenarios (`node tools/build_political_id_raster_assets.mjs --scenario <id>`,
   then again with `--extend true`). The dev server must serve this checkout.
2. When `modern_world` is in scope, the river-paint packs
   (`python tools/repin_river_partition_packs.py`). The new topology bytes and
   owner baseline change each pack's `source` (`landDigest`, `baselineHash`).
   The script rebuilds every pack from its own recorded rivers, parents and
   lake option, refuses any change to `parents` or `support`, regenerates the
   `.transport.json` downloads, and replaces each `packId` and
   `canonicalSha256` in `js/core/river_paint/pilot_manifest.js`.
3. `scenario.baselineHash` in the scoped `landing/assets/sample-projects/*`.
4. The landing hero maps (`tools/build_landing_europe_1936_showcase.py`, for
   blank, HOI4 1936/1939 and TNO 1962), whose metadata counts scenario features,
   and the landing map stage (`tools/build_landing_history_scrubber.py`, for
   HOI4 1936/1939, TNO 1962 and Modern World). CI compares these bytes on Linux,
   so run them with the WSL interpreter.

## Saved projects

The apply tool writes `data/feature-migrations/political_feature_merges.v1.json`
(the applied plans in order, runtime key
`feature_migrations:political_feature_merges`). When a saved project names IDs
the current scenario lacks, `js/core/feature_merge_migration.js` resolves each
through every later merge of that scenario to its final feature. A merged
feature takes a saved value only when the saved IDs cover all of its members
with one identical value (member lists must contain all members); anything
else is dropped and counted in the import summary's ignored entries. Anchors
inside a member move to the merged feature.

## After upstream rebuilds

Any rebuild that regenerates these assets from upstream sources restores the old
parcels. Run the apply tool for every plan in `apply_order.json` order, then
the downstream script above.
`tests/political_feature_merges_contract.test.mjs` fails while any runtime asset
still contains a merged-away ID.
