# QA-067 Russia Refactor Follow-up: RKM/RKO/RKU Adjustments

**Date**: 2026-03-07  
**Status**: Applied  
**Scope**: Post-refactor Russian hierarchy follow-up for `RKM`, `RKO`, and `RKU`

## Summary

After the Russian lower-level data refactor, the Reichskommissariat masks were rechecked and
adjusted in three places:

- `RU_Belgorod` now belongs to `RKU`
- `Khotsimsk`, `Krasnapolle`, and `Klimavichy` now belong to `RKM`
- the full `RU_Pskov` group now belongs to `RKO` instead of `RKM`

## Verification

- `RKU.historical_reference`
  - includes `RU_Belgorod`: `22` features
- `RKO.hoi4` / `RKO.historical_reference`
  - include `RU_Pskov`: `26` features
  - no longer include:
    - `Khotsimsk`
    - `Krasnapolle`
    - `Klimavichy`
- `RKM.hoi4` / `RKM.historical_reference`
  - include:
    - `Khotsimsk`
    - `Krasnapolle`
    - `Klimavichy`
  - no longer include `RU_Pskov`
- Default overlap audit: empty
- Catalog validation errors: `0`

## Notes

- This pass was specifically a consistency fix after the Russia hierarchy refactor, not a redesign of
  the Reichskommissariat model.
