# QA-065 RKU Crimea Transfer Option

**Date**: 2026-03-06  
**Status**: Applied  
**Scope**: `RKU` historical transfer actions

## Summary

`RKU` now exposes a visible historical transfer option that moves the Crimean peninsula subset to
Germany.

This is separate from the existing hidden auto-transfer that moves the `Transnistria`
approximation to Romania when `RKU` core territory is applied.

## Verification

- `RKU` companion actions now include:
  - `transnistria_to_rom`
    - target: `ROM`
    - auto-apply on core territory: `true`
    - hidden in UI: `true`
    - feature count: `26`
  - `crimea_to_ger`
    - target: `GER`
    - auto-apply on core territory: `false`
    - hidden in UI: `false`
    - feature count: `18`
- `RKU` still exposes only `historical_reference`
- Default overlap audit remains empty
- Catalog validation errors: `0`

## Notes

- `crimea_to_ger` is implemented as a peninsula-only subset of the current `UA_Kherson`-sourced
  Crimea features, not the broader north-coast mainland corridor.
