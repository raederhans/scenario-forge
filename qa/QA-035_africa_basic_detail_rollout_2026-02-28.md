# QA-035 Africa Basic Detail Rollout (2026-02-28)

## Summary

Implemented Africa basic-detail rollout into the default detail bundle `data/europe_topology.na_v1.json`.

- Scope: add first-level or first-level-equivalent internal polygons for African countries that previously had no detail.
- Shipping detail bundle remains `na_v1`.
- `EH` (Western Sahara) intentionally remains admin0-only.

## Data Source Strategy

### Natural Earth admin1

Used local `data/ne_10m_admin_1_states_provinces.*` for:

`AO BJ BW BI CM CV CF TD KM CD DJ GQ ER SZ ET GA GH GW KE LS LR MG ML MR MZ NA NE NG CG RW SN SL SO ZA SS SD ST TZ GM TG ZM ZW`

### geoBoundaries ADM1 overrides

Used `geoBoundaries ADM1` instead of Natural Earth for countries where NE was clearly too fine or mixed-level:

- `BF` -> `13`
- `GN` -> `8`
- `CI` -> `14`
- `MW` -> `3`
- `UG` -> `4`

### Explicit skip

- `EH` -> kept as single admin0 polygon by design

## Implementation Notes

### New code

- Added processor: `map_builder/processors/africa_admin1.py`
- Hooked default detail build: `tools/build_na_detail_topology.py`
- Expanded hierarchy-country allowlist: `map_builder/config.py`
- Updated topology-driven hierarchy generation: `tools/generate_hierarchy.py`

### Shell / clipping behavior

- New Africa polygons clip to country shell before entering `na_v1`.
- Shell priority:
  1. existing detail shell
  2. primary topology shell
- Primary shell fallback uses a small metric buffer to preserve small islands omitted by coarse admin0 geometry.
- If a source admin1 feature is fully disjoint from the shell but still belongs to the country, that feature is merged into the shell first.

This was required for:

- `CV` (Brava was outside coarse shell)
- `GQ` (Annobon was outside coarse shell)

## Build Commands

```powershell
python tools/build_na_detail_topology.py --source-topology data/europe_topology.highres.json --output-topology data/europe_topology.na_v1.json
python init_map_data.py
```

## Final Counts

### Bundle total

- `data/europe_topology.na_v1.json` political features: `10542`

### Existing North Africa detail retained

- `DZ = 48`
- `EG = 27`
- `LY = 22`
- `MA = 16`
- `TN = 23`

### Newly added Africa detail

- `AO = 18`
- `BJ = 12`
- `BW = 15`
- `BF = 13`
- `BI = 17`
- `CM = 10`
- `CV = 22`
- `CF = 17`
- `TD = 22`
- `KM = 3`
- `CD = 11`
- `DJ = 6`
- `GQ = 7`
- `ER = 6`
- `SZ = 4`
- `ET = 11`
- `GA = 9`
- `GH = 10`
- `GN = 8`
- `GW = 9`
- `CI = 14`
- `KE = 8`
- `LS = 10`
- `LR = 15`
- `MG = 22`
- `MW = 3`
- `ML = 9`
- `MR = 13`
- `MZ = 11`
- `NA = 13`
- `NE = 8`
- `NG = 37`
- `CG = 12`
- `RW = 5`
- `SN = 14`
- `SL = 4`
- `SO = 13`
- `ZA = 9`
- `SS = 10`
- `SD = 17`
- `ST = 2`
- `TZ = 30`
- `GM = 6`
- `TG = 5`
- `UG = 4`
- `ZM = 10`
- `ZW = 10`
- `EH = 0`

## Hierarchy / UI Integration

- `data/hierarchy.json` regenerated successfully.
- Build output reported `Groups: 832`.
- Africa-specific hierarchy groups present: `538`.
- New Africa detail uses `admin1_group`, so existing sidebar hierarchy and parent-border discovery can consume it without new frontend logic.

## Build Result

- `python init_map_data.py` exit code: `0`
- `[NA Detail] Failed` did not appear in final run
- Output files refreshed:
  - `data/europe_topology.na_v1.json`
  - `data/hierarchy.json`
  - `data/geo_aliases.json`
  - `data/locales.json`

## Known Issues / Follow-up

1. `geopandas` emitted `sjoin_nearest` CRS warnings during build.
   - Build still completed successfully.
   - This should be cleaned by reprojecting to a metric CRS before nearest joins.

2. Some island-country shells require buffered primary fallback.
   - This is now handled for the rollout, but the underlying coarse admin0 shell still omits a few remote small-island parts.

3. `EH` is intentionally not subdivided.

