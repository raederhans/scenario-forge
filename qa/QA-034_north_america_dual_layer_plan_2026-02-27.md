# QA-034: North America Dual-Layer Rollout (US/CA/MX) (2026-02-27)

## Scope
- Add second-layer detail data for Canada, Mexico, and the United States.
- Keep existing RU/CN/IN detail pipeline intact.
- Provide a new detail artifact `europe_topology.na_v1.json` for controlled rollout via query param.
- Promote `na_v1` to the default detail source after data quality repair.

## Implemented Decisions
1. Canada detail source:
- Source: Elections Canada FED 2023 boundaries.
- Granularity: 343 features.
- ID scheme: `CA_FED_{FED_NUM}`.
- Final output is clipped to the Canada admin0 shell so the FED source matches the app's coarse border baseline.

2. Mexico detail source:
- Stage-1 source: geoBoundaries MEX ADM2.
- Granularity target: 300 synthetic zones.
- Method: state-level quota + adjacency-constrained partition.
- ID scheme: `MX_ZN_{STATE}_{NNN}`.

3. US detail source:
- Source boundaries: US Census county boundaries (2024, 500k).
- Source population: US Census county population estimates (2024).
- Granularity target: 900.
- Method:
  - Keep county-level detail for CA/TX/FL.
  - For remaining states, compute quotas with sqrt(pop)-weighted allocation.
  - Auto-fine counties by percentile threshold, then aggregate remaining counties to state quota.
- ID scheme:
  - Fine counties: `US_CNTY_{GEOID}`
  - Coarse zones: `US_ZN_{STATEFP}_{NNN}`

## Repair Plan Executed
1. Default detail loading:
- Changed frontend default detail source from `legacy_bak` to `na_v1`.
- Result: running the dev server at `/` now shows the NA detail artifact without requiring `?detail_source=na_v1`.

2. US / MX partition bug:
- Root cause: `_partition_component()` removed neighbors from `remaining` when they were only queued, so queued-but-uncommitted polygons could be dropped.
- Fix: keep a separate `queued` set and only remove nodes from `remaining` when they are actually popped into the committed group.
- Impact: removed the major missing-coverage regression in both US and MX synthetic aggregation paths.

3. Canada shell alignment:
- Root cause: Canada FED detail was preserved faithfully from source, but the source outline did not match the app's admin0 baseline in the far north.
- Fix: load Natural Earth admin0 country shells and clip CA/MX/US detail output to the matching admin0 shell before merging back into the political layer.
- Impact: eliminated the large northern overflow previously visible in Canada and also tightened US/MX country-shell adherence.

## Code Changes
1. `map_builder/processors/north_america.py`
- Fixed `_partition_component(...)` queue/commit behavior.
- Added `_clip_features_to_country_shell(...)`.
- Added `_load_admin0_country(...)`.
- Updated `apply_north_america_replacement(...)` to clip US/CA/MX detail output to admin0 shells before merging.

2. `js/core/data_loader.js`
- Default `resolveDetailSource()` now returns `na_v1` when no query param is provided or when an unknown source is requested.

3. Existing integration points kept:
- `init_map_data.py` still builds `europe_topology.na_v1.json` through `tools/build_na_detail_topology.py`.
- `map_builder/geo/topology.py` still preserves `detail_tier`.
- `tools/generate_hierarchy.py` still includes `na_v1` in candidate scans.

## Validation Results
### Build
- Full `python init_map_data.py` rebuild completed successfully after the fixes.
- Output artifact updated: `data/europe_topology.na_v1.json`.

### Feature counts
- CA detail count = `343`
- MX detail count = `300`
- US detail count = `900`

### Country-shell coverage vs coarse baseline
Measured against `data/europe_topology.json` union shells after rebuild:

1. United States
- Missing area: `2.15%`
- Overflow area: `0.10%`

2. Canada
- Missing area: `0.53%`
- Overflow area: `0.20%`

3. Mexico
- Missing area: `0.84%`
- Overflow area: `0.17%`

### Interpretation
- The earlier US/MX large missing regions were fixed; both are now within small residual tolerance.
- The earlier Canada far-north overflow was fixed; shell mismatch is now negligible for app rendering.
- Residual sub-1% to ~2% differences are expected from geometry simplification, source mismatch between coarse/detail datasets, and topology reconstruction.

## Runtime / Rollout
- Default behavior now loads `na_v1` in composite mode.
- `?detail_source=legacy_bak` and `?detail_source=highres` remain available for fallback/testing.

## Remaining Known Limits
- Mexico stage-1 zones are synthetic partitions, not official INE federal district geometry.
- The build still emits `geopandas` warnings for `sjoin_nearest` in geographic CRS; this did not block the build but should be normalized to a projected CRS in a later cleanup.
- US residual mismatch is the largest of the three countries and is likely driven by coarse-shell/source differences around coast/island geometry plus simplification, not by dropped polygons.
