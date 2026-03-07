# QA-068 RKK Dagestan And RKM Astrakhan Adjustment

**Date**: 2026-03-07  
**Status**: Applied  
**Scope**: `RKK` / `RKM` post-refactor territorial correction

## Summary

`RKK` now includes the full `RU_Republic_of_Dagestan` group and no longer includes `RU_Astrakhan`.
`RKM` now includes the full `RU_Astrakhan` group.

## Verification

- `RKK`
  - includes `RU_Republic_of_Dagestan`: `50 / 50`
  - includes `RU_Astrakhan`: `0 / 12`
  - feature count: `312`
- `RKM`
  - includes `RU_Republic_of_Dagestan`: `0 / 50`
  - includes `RU_Astrakhan`: `12 / 12`
  - feature count per variant: `927`
- `RKK ∩ RKM = 0`
- default overlap audit: empty
- catalog validation errors: `0`

## Notes

- `RKK` remains on the legacy single `preset_source` path rather than the explicit boundary-variant
  model used by `RKP/RKO/RKU/RKM`.
