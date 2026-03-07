# QA-063 RKU Historical Consolidation And Transnistria Transfer

**Date**: 2026-03-06  
**Status**: Applied  
**Scope**: `RKU` boundary variants, `Transnistria -> ROM` transfer, `Liskinsky -> RKM`

## Summary

`RKU` no longer exposes separate `HOI4` and `Historical` variants. It now uses a single explicit
`historical_reference` mask as the default and only boundary.

This consolidated `RKU` mask now includes the northeastern, Donbas, Luhansk, Zaporizhzhia, Sumy,
and Poltava areas that were previously only present in the broader `HOI4` proxy, while keeping
`Transnistria` outside `RKU` and moving `Liskinsky District` into `RKM`.

## Key Changes

- `RKU` now exposes exactly one boundary variant:
  - `historical_reference`
- `RKU` now includes the full current explicit feature sets for:
  - `UA_Kharkiv` (`27`)
  - `UA_Donetsk` (`18`)
  - `UA_Luhansk` (`18`)
  - `UA_Zaporizhzhia` (`20`)
  - `UA_Sumy` (`18`)
  - `UA_Poltava` (`25`)
- `RKU` explicitly excludes:
  - all `UA_Odessa` features
  - `RU_RAY_50074027B36141655472455` (`Liskinsky District`)
  - `RU_RAY_50074027B21430544456221` (`Taganrog City District`)
- `RKU` now has a hidden auto companion action:
  - `transnistria_to_rom`
  - target: `ROM`
  - `auto_apply_on_core_territory = true`
  - `hidden_in_ui = true`
  - resolved feature count: `26`
- `RKM.hoi4` and `RKM.historical_reference` now both include `Liskinsky District`.

## Verification

- Generation chain completed successfully:
  - `python3 tools/rebuild_reichskommissariat_reference_masks.py`
  - `python3 tools/materialize_hoi4_reichskommissariat_boundaries.py`
  - `python3 tools/build_hoi4_releasable_catalog.py`
- Catalog validation errors: `0`
- `RKU` materialized state:
  - default boundary variant: `historical_reference`
  - boundary variant count: `1`
  - companion actions: `transnistria_to_rom`
  - resolved feature count hint: `350`
- `RKU` does not contain:
  - `Liskinsky District`
  - `Taganrog City District`
- `RKM` contains `Liskinsky District` in both variants.
- Default overlap audit remains empty.

## Notes

- `Transnistria` is implemented as the current explicit `UA_Odessa` 26-feature approximation.
- No new country is created for Transnistria; ownership is transferred to `ROM` only when `RKU`
  core territory is applied.
- `Taganrog` remains outside `RKU` and is not reassigned in this pass.
