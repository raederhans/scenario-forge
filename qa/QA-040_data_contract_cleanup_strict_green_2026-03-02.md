# QA-040: Data Contract Cleanup and Strict Validation Green (2026-03-02)

## Summary

- Completed the first major data-cleanup tranche behind the performance plan.
- `python init_map_data.py --mode i18n --strict` now passes.
- The previous strict blockers were removed by fixing topology preservation, missing-name repair, hierarchy authority filtering, CRS-safe nearest joins, and alias normalization rules.
- Runtime political topology now validates against the expected composed feature set without ID drift.

## What Was Fixed

### 1. Topology build no longer silently drops valid repaired features

- `map_builder/geo/topology.py`
  - political geometry scrubbing now repairs invalid polygons before dropping them
  - the build no longer loses valid features simply because rounding or intermediate repair created temporary invalidity

Impact:

- runtime political topology now keeps the full composed feature set
- previous runtime drift (`expected 11135`, `actual 11098`) is gone

### 2. Detail topology metadata is repaired before export

- `tools/build_na_detail_topology.py`
  - missing names are repaired before writing topology
  - special fallback naming added for known sentinel rows
  - detail topology now gets `computed_neighbors` injected from the political GeoDataFrame before write

Impact:

- `europe_topology.na_v2.json` no longer fails strict on missing names
- `europe_topology.na_v2.json` no longer fails strict on missing neighbor graph

### 3. Sentinel IDs are now explicit policy instead of accidental failures

- `init_map_data.py`
  - added allowlist for known sentinel feature IDs:
    - `GAZ+00?`
    - `WEB+00?`
    - `RUS+99?`
    - `CO_ADM1_COL+99?`
    - `VE_ADM1_VEN+99?`

Impact:

- strict mode now rejects unexpected sentinel-style IDs while allowing known historical exceptions
- illegal-ID failures are gone without breaking existing saved references

### 4. Hierarchy now filters against the authority topology

- `tools/generate_hierarchy.py`
  - added authority topology resolution preference:
    - runtime political
    - detail topology
    - highres
    - primary
  - hierarchy children are filtered to IDs that actually exist in the authority topology
  - raw ADM2/source IDs no longer leak into hierarchy when the final runtime layer does not contain them

Impact:

- previous `missing_from_runtime_topology=64` failure is gone
- final strict result shows `missing_from_europe_topology.runtime_political_v1.json=0`

### 5. `sjoin_nearest` is now projected in hierarchy and North America processors

- `tools/generate_hierarchy.py`
- `map_builder/processors/north_america.py`

Impact:

- removed geographic-CRS nearest-join warnings from the strict path
- nearest assignment is now based on metric projection instead of raw lon/lat

### 6. Alias normalization now treats global name collisions as ambiguity, not hard conflict

- `tools/geo_key_normalizer.py`
  - ambiguous aliases are no longer inserted into `alias_to_stable_key`
  - unique aliases still resolve normally
  - extra disambiguated aliases are generated using country/admin context
  - hard `conflict_count` now stays at `0`
  - ambiguity is still recorded for inspection via `ambiguous_alias_count` and sample payload

Impact:

- previous strict failure `geo_aliases.json: conflicts=1112` is gone
- translation resolution still keeps stable-key lookup, but no longer pretends ambiguous aliases are globally unique

## Validation

### Syntax

- `python -m py_compile init_map_data.py tools/build_na_detail_topology.py tools/build_runtime_political_topology.py tools/generate_hierarchy.py tools/geo_key_normalizer.py map_builder/geo/topology.py map_builder/processors/north_america.py`
  - exit code `0`

### Detail build

- `python init_map_data.py --mode detail`
  - exit code `0`
  - note: this mode still warns if `hierarchy.json` has not been regenerated yet, which is expected because detail mode does not rebuild hierarchy

### Strict build

- `python init_map_data.py --mode i18n --strict`
  - exit code `0`

Strict summary:

```text
[Validate] europe_topology.json: ids=199, duplicates=0, missing_names=0, illegal_ids=0
[Validate] europe_topology.na_v2.json: ids=11120, duplicates=0, missing_names=0, illegal_ids=0
[Validate] europe_topology.runtime_political_v1.json: ids=11135, duplicates=0, missing_names=0, illegal_ids=0
[Validate] hierarchy.json: children=8759, missing_from_europe_topology.runtime_political_v1.json=0
[Validate] geo_aliases.json: conflicts=0
```

## Files Changed

- `init_map_data.py`
- `map_builder/geo/topology.py`
- `map_builder/processors/north_america.py`
- `tools/build_na_detail_topology.py`
- `tools/build_runtime_political_topology.py`
- `tools/generate_hierarchy.py`
- `tools/geo_key_normalizer.py`

## Remaining Notes

1. `--mode detail` alone can still report hierarchy mismatch until `--mode i18n` regenerates hierarchy. This is now a workflow artifact, not a data-contract failure.
2. Alias ambiguity still exists in the world data. The fix here is to stop treating ambiguity as a unique alias mapping, not to pretend the names are globally unique.
3. This cleanup tranche made strict validation green, but it did not yet finish the renderer-side dirty-rect and cache-partition work.

## Recommended Next Step

- Continue with renderer phase two:
  - dirty-region redraw
  - explicit cache layers
  - measured draw/hit latency instrumentation
