# QA-066 RKM Saint Petersburg And Middle Volga Expansion

**Date**: 2026-03-07  
**Status**: Applied  
**Scope**: `RKM` boundary masks and historical transfer actions

## Summary

`RKM` now includes Saint Petersburg plus the full current explicit feature sets for Tambov,
Kostroma, the Republic of Mordovia, Chuvashia, and Samara.

A new visible historical transfer option has also been added so Saint Petersburg can be moved from
Moskowien to Germany without creating a new country.

## Verification

- `RKM.hoi4` and `RKM.historical_reference` now each contain `939` features.
- Newly included groups:
  - `RU_Saint_Petersburg`: `1`
  - `RU_Tambov`: `29`
  - `RU_Kostroma`: `30`
  - `RU_Republic_of_Mordovia`: `24`
  - `RU_Chuvash_Republic`: `26`
  - `RU_Samara`: `37`
- `saint_petersburg_to_ger`
  - target: `GER`
  - hidden in UI: `false`
  - auto-apply on core territory: `false`
  - feature count: `2`
- `greater_finland_to_fin`
  - unchanged
  - feature count: `25`
- Default overlap audit remains empty.
- Catalog validation errors: `0`

## Notes

- `Saint Petersburg` is represented by both `RU_CITY_SAINT_PETERSBURG` and the paired duplicate
  geometry `RU_CITY_SAINT_PETERSBURG__dup1`, and both are included in the Germany transfer option.
- `Taganrog` remains excluded from `RKM`.
