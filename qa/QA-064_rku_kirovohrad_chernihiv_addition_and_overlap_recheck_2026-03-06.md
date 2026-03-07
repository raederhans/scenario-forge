# QA-064 RKU Kirovohrad Chernihiv Addition And Overlap Recheck

**Date**: 2026-03-06  
**Status**: Applied  
**Scope**: `RKU` historical mask expansion and inter-RK overlap recheck

## Summary

`UA_Kirovohrad` and `UA_Chernihiv` were missing from the consolidated `RKU` historical mask. Both
groups have now been added to `RKU`.

After regeneration, `RKU` remains the only Reichskommissariat that owns its subordinate Ukraine
mask features. No overlaps remain between `RKU` and `RKP`, `RKO`, or `RKM`.

## Verification

- `UA_Kirovohrad` included in `RKU`: `22` features
- `UA_Chernihiv` included in `RKU`: `22` features
- `RKU ∩ RKP`: `0`
- `RKU ∩ RKO.hoi4`: `0`
- `RKU ∩ RKO.historical_reference`: `0`
- `RKU ∩ RKM.hoi4`: `0`
- `RKU ∩ RKM.historical_reference`: `0`
- Default overlap audit: empty
- Catalog validation errors: `0`

## Notes

- `RKU` still exposes only `historical_reference`.
- `transnistria_to_rom` remains unchanged with `26` features and auto-applies on `RKU` core territory.
