# TNO spherical water fix plan

## Goal

Fix the TNO startup ocean overlay and unstable water interaction by making D3 spherical geometry validity part of the water and mask contract.

## Root cause

- Some TNO water polygon parts are valid in Shapely but become full-sphere polygons in D3.
- `tno_sea_of_marmara` has one tiny unsafe polygon part that D3 treats as world-sized, so water hit testing can select it across large land areas.
- `tno_south_indian_antarctic_ocean` and TNO runtime land masks also trigger world-bounds behavior in D3.

## Implementation steps

- [x] Add task documentation and keep progress current.
- [x] Add renderer-side D3 spherical geometry checks for water polygons and land masks.
- [x] Sanitize effective scenario water features before drawing and UI selection paths consume them.
- [x] Skip unsafe water hit geometries before they enter spatial indexing.
- [x] Reject unsafe scenario land masks in ocean clipping and surface cache versioning.
- [x] Extend existing water geometry and renderer contract tests.
- [x] Repair checked-in TNO water/mask data and the builder path that emits it.
- [x] Run targeted tests and a final static review.

## Verification

- `node --test tests/scenario_chunk_contracts.test.mjs`
- `python -m unittest tests.test_tno_water_geometries`
- `python -m unittest tests.test_tno_bundle_builder`
- D3 one-off probe for Marmara and runtime masks.
