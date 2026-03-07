# QA-062 RKO Ostland Belarus And Marijampole Corrections 2026-03-06

**Date**: 2026-03-06  
**Scope**: `RKO` boundary variants, Belarus overlap cleanup, and automatic `Marijampole -> GER` transfer

## Summary

This pass corrected the Ostland setup in three ways:

- `RKO` no longer absorbs `PL_Warmian_Masurian`; Warmia-Masuria stays with Germany.
- All current Belarus feature groups are now assigned to `RKO` in both `hoi4` and `historical_reference`.
- `Marijampolė` (`LT024`) is excluded from `RKO` and is instead auto-transferred to `GER` when Ostland core territory is applied.

## Data Changes

Updated in [tools/rebuild_reichskommissariat_reference_masks.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/rebuild_reichskommissariat_reference_masks.py):

- `RKO.hoi4` and `RKO.historical_reference` now resolve as:
  - all `EE`
  - all `LV`
  - all `LT` except `LT024`
  - all Belarus groups:
    - `BY_Brest`
    - `BY_Minsk`
    - `BY_City_of_Minsk`
    - `BY_Grodno`
    - `BY_Vitebsk`
    - `BY_Gomel`
    - `BY_Mogilev`
- `RKM.hoi4` and `RKM.historical_reference` no longer retain Belarus feature masks.
- Added hidden auto companion action:
  - `RKO -> GER / ostland_marijampole_to_ger`
  - feature set: `LT024`
  - `auto_apply_on_core_territory = true`
  - `hidden_in_ui = true`

## Runtime Behavior

Updated in:

- [sidebar.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js)
- [releasable_manager.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/releasable_manager.js)
- [materialize_hoi4_reichskommissariat_boundaries.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/materialize_hoi4_reichskommissariat_boundaries.py)
- [build_hoi4_releasable_catalog.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/build_hoi4_releasable_catalog.py)

Behavior now is:

- manual historical-transfer buttons still render only for visible, non-hidden companion actions
- hidden companion actions can be declared in data
- when `Reapply Core Territory` is used for `RKO`, `LT024` is automatically transferred to `GER`

## Verification

After rerunning the generation chain:

- `RKO.hoi4`: `55` features
- `RKO.historical_reference`: `55` features
- Belarus features in `RKO.hoi4`: `35`
- Belarus features in `RKO.historical_reference`: `35`
- Belarus features in `RKM.hoi4`: `0`
- Belarus features in `RKM.historical_reference`: `0`
- `RKO/RKM` Belarus overlap: `0`
- `LT024` is absent from both `RKO` variants and present in `ostland_marijampole_to_ger`

Key checks confirmed:

- `Horki` and `Mogilev Interior` are now included in `RKO`
- `Grodno` is now included in `RKO`
- `LT024` is not part of `RKO`
- `LT024` is included in the hidden auto transfer to `GER`
