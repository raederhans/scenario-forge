# QA-096 US Topology Progress And Naming Refactor

**Date**: 2026-03-16  
**Status**: Implemented, data/runtime validated  
**Scope**: US hybrid topology continuity and merge work, followed by US naming refactor for county/coarse features  
**Constraints**: Data architecture first; preserve `feature_id`; avoid UI code changes unless runtime validation proves a frontend defect

---

## 0) Executive Summary

The US work is now in a good intermediate state with both of the intended
phases implemented:

1. **US topology continuity and merge repair**
2. **US naming refactor**

The current US topology no longer produces non-contiguous coarse synthetic
zones, and the current US naming is no longer dominated by opaque
`State Zone N` labels.

The naming layer now behaves as follows:

- strict `Top 25` US city features use the bare city name
- all other fine/coarse US features fall back to full legal county naming
  (`NAMELSAD`)
- old naming is preserved through `legacy_name`
- county anchor naming is preserved through `anchor_county_name`

No UI code was changed for this naming refactor. Validation was performed at
the detail topology, runtime topology, alias, and locale contract layers.

---

## 1) Current Progress

### 1.1 Phase A: US continuity and merge repair

Completed.

This phase fixed the underlying problem where a single US coarse synthetic zone
could span multiple disconnected county components.

Result:

- `US_ZN_*` coarse zones now respect county connectivity
- US state quota overrides are active
- runtime political topology and `computed_neighbors` were rebuilt
- scenario runtime bundles and related downstream assets were regenerated

### 1.2 Phase B: US naming refactor

Completed.

This phase replaced opaque zone-style naming with readable location naming:

- city name for strict `Top 25` city-hit features
- full legal county name for all other features
- legacy names preserved as aliases

Result:

- coarse `Zone N` names are gone from US display names
- most fine county features now expose readable `County / Parish / Borough`
  naming
- a small number of coarse features now expose city names directly

---

## 2) Methodology

### 2.1 Data architecture first

The approach remained consistent across both phases:

- treat US geography as a build-pipeline problem, not a UI problem
- preserve `feature_id` as the cross-layer key
- rebuild detail/runtime artifacts instead of adding renderer exceptions
- keep migration and alias assets explicit where topology identity changes are
  involved

### 2.2 Phase A strategy: continuity before visual polish

For the topology repair phase:

- only target synthetic US coarse zones (`US_ZN_*`)
- enforce county-component continuity as a hard constraint
- reduce unnecessary land count through state-level quota overrides
- keep downstream runtime/scenario assets synchronized

This ensured that later naming work would operate on stable, interpretable US
features instead of disconnected synthetic groups.

### 2.3 Phase B strategy: naming as a post-build pass

For the naming phase:

- do not change geometry
- do not change `feature_id`
- do not touch migration assets
- generate US display names only after US zones are built

The naming decision tree is:

1. If the feature contains one of the strict top-25 US city candidates:
   use the bare city name.
2. Otherwise use the feature's county anchor full legal name (`NAMELSAD`).

To preserve compatibility:

- `legacy_name` stores the previous short/zone-style display name
- `anchor_county_name` stores the county full legal name
- `geo_aliases` is regenerated so old names remain searchable

### 2.4 Alias policy

Alias generation was extended so name-like values can also receive
disambiguated variants such as:

- `Alias [State]`
- `Alias (US)`

This materially improved old-name searchability for renamed US features.

---

## 3) Files Changed

### 3.1 Topology continuity / merge phase

- `map_builder/config.py`
- `map_builder/processors/north_america.py`
- `map_builder/processors/detail_shell_coverage.py`
- `tools/build_na_detail_topology.py`
- `tools/refresh_us_topologies.py`
- `data/europe_topology.na_v2.json`
- `data/europe_topology.runtime_political_v1.json`
- `data/feature-migrations/by_hybrid_v1.json`
- `data/hierarchy.json`
- `data/geo_aliases.json`
- `data/locales.json`
- `data/scenarios/blank_base/manifest.json`
- `data/scenarios/hoi4_1936/*`
- `data/scenarios/hoi4_1939/*`
- `data/scenarios/index.json`
- `data/scenarios/modern_world/manifest.json`
- `data/scenarios/tno_1962/manifest.json`

### 3.2 Naming refactor phase

- `map_builder/config.py`
- `map_builder/cities.py`
- `map_builder/processors/north_america.py`
- `map_builder/geo/topology.py`
- `tools/build_runtime_political_topology.py`
- `tools/build_na_detail_topology.py`
- `tools/geo_key_normalizer.py`
- `data/europe_topology.na_v2.json`
- `data/europe_topology.runtime_political_v1.json`
- `data/geo_aliases.json`
- `data/locales.json`

### 3.3 Worktree note

`map_builder/cities.py` is currently present as an untracked file in the
working tree. The naming catalog helper change for this work lives there.

---

## 4) Result Metrics

### 4.1 Topology phase metrics

Source:

- `.runtime/reports/generated/us_topology_refresh_metrics.json`
- `.runtime/reports/generated/us_topology_migration_audit.json`

Current recorded topology metrics:

- US detail features: `914`
- US runtime features: `914`
- US coarse features: `432`
- US fine features: `482`
- US duplicate IDs: `0`
- US coarse connectivity violations: `0`
- detail/runtime `computed_neighbors`: valid
- runtime US IDs match detail: `true`

Migration asset metrics from the topology phase:

- US migration entries: `411`
- US migration expansions: `392`

### 4.2 Naming phase metrics

Source:

- `.runtime/reports/generated/us_naming_audit.json`

Current recorded naming metrics:

- US detail features: `914`
- US runtime features: `914`
- detail IDs match pre-naming backup: `true`
- runtime IDs match detail: `true`
- duplicate IDs: `0`
- geometry drift: `0`
- changed US display names: `906`
- city-named US features: `24`
- coarse city-named US features: `2`
- coarse `Zone N` display names remaining: `0`
- runtime/detail name mismatches: `0`

Alias coverage:

- `legacy_name`: `910 / 913`
- `anchor_county_name`: `914 / 914`

---

## 5) What Changed In User-Facing Naming

Examples:

- `US_CNTY_04013`: `Maricopa` -> `Phoenix`
- `US_CNTY_04001`: `Apache` -> `Apache County`
- coarse zone names now prefer a city hit or county anchor name rather than
  `Alabama Zone 4`-style labels

This creates a much more readable fill workflow because:

- obvious metro areas surface recognizable city names
- non-metro areas surface county names users can interpret
- synthetic zone numbering no longer dominates the map

---

## 6) Remaining Known Edges

### 6.1 Three irreducibly ambiguous legacy short names

The only legacy alias cases that do not uniquely map are:

- `Baltimore`
- `St. Louis`
- `Houston`

These collide with same-state major city names, so the short legacy token is
inherently ambiguous.

The full county anchor names are still unique and resolvable:

- `Baltimore County`
- `St. Louis County`
- `Houston County`

### 6.2 Browser/UI smoke not yet run for naming phase

This naming refactor was validated at the data/runtime contract layer only.

Not yet performed:

- browser-side search smoke
- tooltip/inspector visual smoke
- batch fill interaction smoke on renamed US features

No evidence currently suggests a frontend defect, but this remains an optional
follow-up check.

### 6.3 Unrelated existing scenario issue

From the prior topology execution slice, `tno_1962` still has an unrelated
existing rule failure:

- `east_asia / japan_taiwan_colony_1962 resolved zero features`

This is not caused by the US topology or naming work.

---

## 7) Artifacts

- `.runtime/reports/generated/us_topology_refresh_metrics.json`
- `.runtime/reports/generated/us_topology_migration_audit.json`
- `.runtime/reports/generated/us_naming_audit.json`
- `.runtime/tmp/us_naming_before/europe_topology.na_v2.json`
- `.runtime/tmp/us_naming_before/europe_topology.runtime_political_v1.json`

---

## 8) Conclusion

The US work is now structurally in a much better place:

- topology continuity is fixed
- unnecessary coarse fragmentation is reduced
- naming is materially more human-readable
- IDs and geometry are stable across the naming refactor
- alias/locales/runtime assets are synchronized

The remaining follow-up, if desired, is not another build-layer change. It is a
light browser-side smoke pass for search, tooltip, inspector, and fill flows on
renamed US features.
