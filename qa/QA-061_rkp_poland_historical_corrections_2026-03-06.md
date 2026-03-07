# QA-061 RKP Poland Historical Corrections 2026-03-06

**Date**: 2026-03-06  
**Scope**: `RKP.historical_reference` and `RKP -> GER / annexed_poland_to_ger` only

## Summary

This pass corrected the Poland-only historical mask issues reported after the feature-mask rebuild:

- `PL_Podlaskie` is now transferred with `annexed_poland_to_ger`.
- `Karviná` is now explicitly transferred with `annexed_poland_to_ger`.
- The GG/GER western seam was widened on the Generalgouvernement side instead of staying trapped in the German annexation mask.
- Southern Galicia continuity was revalidated and kept explicit in the historical mask.
- `RKP.hoi4` was left unchanged.

## Data Changes

Updated in [tools/rebuild_reichskommissariat_reference_masks.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/rebuild_reichskommissariat_reference_masks.py):

- Added full `PL_Podlaskie` to `annexed_poland_to_ger`.
- Added `CZ_ADM2_57006924B63031935780571` (`Karviná`) to `annexed_poland_to_ger`.
- Moved the following seam features into `RKP.historical_reference`:
  - `PL_POW_1001` `bełchatowski`
  - `PL_POW_1006` `łódzki wschodni`
  - `PL_POW_1009` `pajęczański`
  - `PL_POW_1021` `brzeziński`
  - `PL_POW_2404` `częstochowski`
  - `PL_POW_2406` `kłobucki`
  - `PL_POW_2464` `Częstochowa`
- Kept lower Galicia explicit via the historical mask, including checked southern anchors:
  - `Drohobych`
  - `Sambir`
  - `Staryi Sambir`
  - `Stryi`
  - `Kalush`
  - `Kolomyia`
  - `Borschiv`
  - `Chortkiv`

## Verification

After rerunning the generation chain:

- `RKP.hoi4`: `150` features
- `RKP.historical_reference`: `180` features
- `RKP.annexed_poland_to_ger`: `154` features
- `RKP.historical_reference ∩ annexed_poland_to_ger`: `0`

Confirmed:

- `PL_Podlaskie` is present in the German annexation action and absent from `RKP.historical_reference`.
- `Karviná` is present in the German annexation action.
- The widened GG seam features are present in `RKP.historical_reference` and absent from the German annexation action.
- Southern Galicia anchor features remain present in `RKP.historical_reference`.

## Follow-up Micro Adjustment

A second same-day tweak adjusted the Upper Silesia and Lodz seam split:

- Moved into `RKP.historical_reference`:
  - `PL_POW_2409` `myszkowski`
  - `PL_POW_2416` `zawierciański`
  - `PL_POW_2465` `Dąbrowa Górnicza`
- Moved into `annexed_poland_to_ger`:
  - `PL_POW_1001` `bełchatowski`
  - `PL_POW_1009` `pajęczański`
  - `PL_POW_2406` `kłobucki`

Post-adjustment counts remained:

- `RKP.hoi4`: `150`
- `RKP.historical_reference`: `180`
- `RKP.annexed_poland_to_ger`: `154`
- overlap between `RKP.historical_reference` and `annexed_poland_to_ger`: `0`

## Variant Simplification

After the Poland historical mask stabilized, the exposed `RKP` boundary choice was simplified:

- `RKP` no longer exposes a separate `HOI4` boundary variant.
- `RKP.default_boundary_variant_id` is now `historical_reference`.
- The sidebar no longer renders boundary-variant buttons or extra variant labels for `RKP`, because only one boundary remains exposed.
- `RKO`, `RKU`, and `RKM` still keep both `hoi4` and `historical_reference`.

Updated artifacts:

- [reichskommissariat_rkp__boundary_variant__historical_reference/included.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__boundary_variant__historical_reference/included.geojson)
- [reichskommissariat_rkp__boundary_variant__historical_reference/excluded_border_candidates.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__boundary_variant__historical_reference/excluded_border_candidates.geojson)
- [reichskommissariat_rkp__boundary_variant__historical_reference/feature_review.csv](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__boundary_variant__historical_reference/feature_review.csv)
- [reichskommissariat_rkp__companion_action__annexed_poland_to_ger/included.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__companion_action__annexed_poland_to_ger/included.geojson)
- [reichskommissariat_rkp__companion_action__annexed_poland_to_ger/excluded_border_candidates.geojson](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__companion_action__annexed_poland_to_ger/excluded_border_candidates.geojson)
- [reichskommissariat_rkp__companion_action__annexed_poland_to_ger/feature_review.csv](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/releasables/reichskommissariat_rkp__companion_action__annexed_poland_to_ger/feature_review.csv)
