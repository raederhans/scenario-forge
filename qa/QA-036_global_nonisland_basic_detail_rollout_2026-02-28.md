# QA-036 Global Non-Island Basic Detail Rollout (2026-02-28)

## Summary

Implemented the next enriched detail bundle `data/europe_topology.na_v2.json` to cover the remaining non-island countries that previously still fell back to admin0 in the country list.

- Scope: add first-level or first-level-equivalent internal polygons for the remaining non-island countries.
- Shipping rollout target: `na_v2`
- `MC`, `MO`, `EH` intentionally use `admin0 passthrough` rather than synthetic subdivisions.

## Country Scope

Countries covered in this rollout:

`AD AR BA BN BO BR BZ CL CO CR DO EC EH GB GR GT GY HN HT HK ID LI LU MC ME MO NI PA PE PG PY SM SR SV TL UY VE XK`

## Data Source Strategy

### Natural Earth admin1

Used local `data/ne_10m_admin_1_states_provinces.*` for:

`AD AR BN BO BR BZ CL CO CR DO EC GR GT GY HN HT HK LI LU ME NI PA PE PG PY SM SR SV TL UY VE XK`

### Special sources

- `GB` -> GISCO `NUTS_RG_10M_2021_4326_LEVL_1.geojson` -> `12`
- `BA` -> `geoBoundaries BIH ADM1` -> `3`
- `ID` -> `geoBoundaries IDN ADM1` -> `34`

### Admin0 passthrough

- `MC` -> `1`
- `MO` -> `1`
- `EH` -> `1`

## Implementation Notes

### New code

- Added processor: `map_builder/processors/global_basic_admin1.py`
- Extended source/config matrix in `map_builder/config.py`
- Updated detail bundle builder to emit `data/europe_topology.na_v2.json`
- Added frontend `detail_source=na_v2`
- Updated hierarchy scan order to prefer `na_v2`

### Shell / clipping behavior

- New global-basic polygons clip to country shell before entering `na_v2`
- Shell priority:
  1. existing detail shell
  2. primary topology shell
- Primary shell fallback uses 50 km metric buffer
- If a source feature is fully disjoint but still belongs to the country, that feature is unioned into the shell before clipping

This was required for:

- `CO` -> shell augmented with `2` disjoint source features
- `VE` -> shell augmented with `1` disjoint source feature

### Source cleanup fix

- `CO` had one Natural Earth row with no usable name columns
- Processor now coalesces multiple name columns and falls back to stable ID-derived names instead of silently dropping the feature

## Build Commands

```powershell
python tools/build_na_detail_topology.py --source-topology data/europe_topology.highres.json --output-topology data/europe_topology.na_v2.json
python init_map_data.py
```

## Final Counts

### Bundle total

- `data/europe_topology.na_v2.json` political features: `11120`
- detail-covered countries: `174`

### Newly covered country counts

- `AD = 7`
- `AR = 24`
- `BA = 3`
- `BN = 4`
- `BO = 9`
- `BR = 27`
- `BZ = 6`
- `CL = 16`
- `CO = 34`
- `CR = 7`
- `DO = 32`
- `EC = 24`
- `EH = 1`
- `GB = 12`
- `GR = 14`
- `GT = 22`
- `GY = 10`
- `HN = 18`
- `HT = 10`
- `HK = 18`
- `ID = 34`
- `LI = 11`
- `LU = 3`
- `MC = 1`
- `ME = 21`
- `MO = 1`
- `NI = 17`
- `PA = 12`
- `PE = 26`
- `PG = 20`
- `PY = 18`
- `SM = 9`
- `SR = 10`
- `SV = 14`
- `TL = 13`
- `UY = 19`
- `VE = 26`
- `XK = 30`

### Existing key counts retained

- `US = 900`
- `CA = 343`
- `MX = 300`
- `AO = 18`
- `DZ = 48`
- `RU = 1764`
- `CN = 2391`
- `IN = 719`

## Remaining Primary Fallback Countries

After this rollout, primary fallback remains only for island / polar / micro exceptions:

`AQ AU AX BS CU FK FO GG GL GS HM IM IO JE JM MU MV NZ PM PR SC SH TF TT VA`

Count: `25`

## Hierarchy / UI Integration

- `data/hierarchy.json` regenerated successfully
- Build output reported `Groups: 1410`
- New global-basic detail uses `admin1_group`, so existing sidebar hierarchy and parent-border discovery can consume it without new frontend logic
- `na_v2` is available through `?detail_source=na_v2`

## Build Result

- `python tools/build_na_detail_topology.py ... na_v2.json` exit code: `0`
- `python init_map_data.py` exit code: `0`
- Output files refreshed:
  - `data/europe_topology.na_v2.json`
  - `data/hierarchy.json`
  - `data/geo_aliases.json`
  - `data/locales.json`

## Known Issues / Follow-up

1. `geopandas` still emits `sjoin_nearest` CRS warnings during hierarchy generation.
   - Build completed successfully.
   - This should be cleaned by projecting to a metric CRS before nearest joins.

2. `na_v2` is implemented and validated, but frontend default can remain on `na_v1` until visual QA confirms no country-specific regressions.

3. `MC`, `MO`, `EH` remain single-part in detail by design; they are not synthetic subdivisions.
