# QA-042 AU/NZ Admin1 And AU City Execution

## Summary
- Added Australia and New Zealand to the `na_v2` detail pipeline as first-level regions.
- Added `Sydney` and `Perth` as separate Australian city polygons carved out of their parent admin1 regions.
- Rebuilt `na_v2`, `runtime_political_v1`, `hierarchy`, `geo_aliases`, `locales`, and `manifest`.
- Strict validation is green after the rebuild.

## Scope Delivered
### Australia
- Added 8 core admin1 regions:
  - `AU_ADM1_AUS-2650` Northern Territory
  - `AU_ADM1_AUS-2651` Western Australia
  - `AU_ADM1_AUS-2653` Australian Capital Territory
  - `AU_ADM1_AUS-2654` New South Wales
  - `AU_ADM1_AUS-2655` South Australia
  - `AU_ADM1_AUS-2656` Victoria
  - `AU_ADM1_AUS-2657` Queensland
  - `AU_ADM1_AUS-2660` Tasmania
- Added city overrides:
  - `AU_CITY_SYDNEY`
  - `AU_CITY_PERTH`
- Preserved one remote territory in final topology/runtime:
  - `AU_REMOTE_INDIAN_OCEAN_TERRITORIES`

### New Zealand
- Added 17 core first-level regions:
  - `NZ_ADM1_NZL-3334`
  - `NZ_ADM1_NZL-3396`
  - `NZ_ADM1_NZL-3397`
  - `NZ_ADM1_NZL-3398`
  - `NZ_ADM1_NZL-3399`
  - `NZ_ADM1_NZL-3400`
  - `NZ_ADM1_NZL-3401`
  - `NZ_ADM1_NZL-3402`
  - `NZ_ADM1_NZL-3403`
  - `NZ_ADM1_NZL-3404`
  - `NZ_ADM1_NZL-3405`
  - `NZ_ADM1_NZL-3406`
  - `NZ_ADM1_NZL-3407`
  - `NZ_ADM1_NZL-3408`
  - `NZ_ADM1_NZL-5468`
  - `NZ_ADM1_NZL-5469`
  - `NZ_ADM1_NZL-5470`

## Code Changes
- Added vector-archive fetch support in [fetch.py](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/io/fetch.py).
- Added ABS SUA 2021 configuration and AU/NZ country rules in [config.py](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/config.py).
- Upgraded Natural Earth global basic replacement to support:
  - allowlisted admin1 codes
  - merge-minor-into-parent rules
  - preserved primary passthrough features
  in [global_basic_admin1.py](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/processors/global_basic_admin1.py).
- Added dedicated AU city override processor in [au_city_overrides.py](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/processors/au_city_overrides.py).
- Inserted AU city override step into the detail bundle builder in [build_na_detail_topology.py](/C:/Users/raede/Desktop/dev/mapcreator/tools/build_na_detail_topology.py).

## Validation
### Build Commands
```bash
python tools/build_na_detail_topology.py --source-topology data/europe_topology.highres.json --output-topology data/europe_topology.na_v2.json
python tools/build_runtime_political_topology.py --primary-topology data/europe_topology.json --detail-topology data/europe_topology.na_v2.json --output-topology data/europe_topology.runtime_political_v1.json
python init_map_data.py --mode i18n --strict
```

### Strict Result
- `europe_topology.na_v2.json`: `ids=11133`, `missing_names=0`, `illegal_ids=0`, `world_bounds=0`
- `europe_topology.runtime_political_v1.json`: `ids=11159`, `missing_names=0`, `illegal_ids=0`, `world_bounds=0`
- `hierarchy.json`: `children=8785`, `missing_from_runtime=0`
- `geo_aliases.json`: `conflicts=0`

### Runtime Checks
- Australia runtime features now include:
  - 8 admin1 regions
  - `AU_CITY_SYDNEY`
  - `AU_CITY_PERTH`
  - `AU_REMOTE_INDIAN_OCEAN_TERRITORIES`
- New Zealand runtime now includes 17 admin1 regions.
- Hierarchy groups now include:
  - `AU_New_South_Wales = [AU_ADM1_AUS-2654, AU_CITY_SYDNEY]`
  - `AU_Western_Australia = [AU_ADM1_AUS-2651, AU_CITY_PERTH]`
  - 17 `NZ_*` admin1 groups
- Locale keys exist for:
  - `Sydney`
  - `Perth`
  - `New South Wales`
  - `Western Australia`
  - `Auckland`
  - `Wellington`
- Geo alias entries exist for:
  - `Sydney -> id::AU_CITY_SYDNEY`
  - `Perth -> id::AU_CITY_PERTH`
  - `New South Wales -> id::AU_ADM1_AUS-2654`
  - `Western Australia -> id::AU_ADM1_AUS-2651`
  - `Auckland -> id::NZ_ADM1_NZL-3398`
  - `Wellington -> id::NZ_ADM1_NZL-5469`

## Known Caveat
- `Ashmore and Cartier Islands` was wired in as a preserved AU passthrough candidate, but it still collapses out of the final detail/runtime topology during topology quantization / round-trip repair.
- Root cause:
  - the primary `AU__1` geometry is degenerate
  - the Natural Earth fallback geometry is valid, but the feature is still too small to survive the current topology round-trip
- Result:
  - `AU_REMOTE_ASHMORE_CARTIER` is not present in final `na_v2` / runtime outputs
  - `AU_REMOTE_INDIAN_OCEAN_TERRITORIES` does survive
- This does not block AU/NZ admin1 coverage or Sydney/Perth city support.

## Recommended Follow-up
- If Ashmore retention is required, add a dedicated micro-territory retention rule that runs before topology export, likely one of:
  - protected minimum-area buffering for selected stable IDs
  - separate micro-territory overlay handling outside the shared topology quantization path
