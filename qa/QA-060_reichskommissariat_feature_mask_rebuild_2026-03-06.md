# QA-060: Reichskommissariat Feature-Mask Rebuild

**Date**: 2026-03-06  
**Severity**: HIGH  
**Scope**: `RKP`, `RKO`, `RKU`, `RKM` boundary variants and historical ownership-transfer actions  
**Supersedes**: QA-059, QA-056

---

## Summary

This pass replaces the previous whole-group approximation workflow with explicit feature masks derived from manual reference-map review.

Implemented result:

- `RKP`, `RKO`, `RKU`, `RKM` now expose only two boundary variants:
  - `hoi4`
  - `historical_reference`
- `RKP -> GER` remains available as `annexed_poland_to_ger`, but now resolves from an explicit feature mask instead of mixed hierarchy-group shortcuts.
- `RKM -> FIN` remains available as `greater_finland_to_fin`, also as an explicit feature mask.
- The Reichskommissariat materializer now hard-fails if any of those four RK entries or the two historical transfer actions still use country/group/prefix inputs or exclusion-based shorthand.

---

## Why QA-059 Was Not Sufficient

QA-059 fixed the first round of HOI4-trigger alignment, but its implementation still depended on coarse group expansion in places where the reference maps clearly required feature-level masking.

The incorrect part was not the existence of `boundary_variants` and `companion_actions`.

The incorrect part was the selection method:

- `legacy_approx` remained user-visible.
- several RK footprints still came from whole modern admin groups and then trimmed heuristically.
- `RKP -> GER` and `RKM -> FIN` still depended on province-level approximations instead of explicit reviewed feature sets.

That method was too blunt for the Polish GG/annexed split, Ostland Belarus edge, and Greater Finland transfer edge.

---

## Implemented Changes

### 1. Explicit feature-source-of-truth

`data/releasables/hoi4_reichskommissariat_boundaries.internal.json` now stores explicit `include_feature_ids` for:

- `RKP.hoi4`
- `RKP.historical_reference`
- `RKP.annexed_poland_to_ger`
- `RKO.hoi4`
- `RKO.historical_reference`
- `RKU.hoi4`
- `RKU.historical_reference`
- `RKM.hoi4`
- `RKM.historical_reference`
- `RKM.greater_finland_to_fin`

No hierarchy-group or country-code shorthand remains in those rules.

### 2. Variant set cleanup

The public variant set is now fixed:

- `hoi4`
- `historical_reference`

`legacy_approx` is no longer emitted for these four RK entries.

### 3. Historical transfer action cleanup

The two retained ownership-transfer actions are now:

- `RKP -> GER`: `annexed_poland_to_ger`
- `RKM -> FIN`: `greater_finland_to_fin`

The previous `greater_finland_medium_to_fin` id is retired.

### 4. Geometry review artifacts

New tooling:

- `tools/rebuild_reichskommissariat_reference_masks.py`

Generated review bundles now exist under:

- `reports/generated/releasables/reichskommissariat_rkp__*`
- `reports/generated/releasables/reichskommissariat_rko__*`
- `reports/generated/releasables/reichskommissariat_rku__*`
- `reports/generated/releasables/reichskommissariat_rkm__*`

Each reviewed rule emits:

- `included.geojson`
- `excluded_border_candidates.geojson`
- `feature_review.csv`
- `manifest.json`

### 5. Materializer and catalog constraints

`tools/materialize_hoi4_reichskommissariat_boundaries.py` now:

- rejects non-explicit inputs for the four RK variants and the two historical actions
- records feature-name lists in the audit
- records added/removed feature diffs relative to the previous source snapshot
- fails if default RK variants still overlap

`tools/build_hoi4_releasable_catalog.py` now validates:

- the RK variant ids are exactly `hoi4` + `historical_reference`
- `RKP` action ids are exactly `annexed_poland_to_ger`
- `RKM` action ids are exactly `greater_finland_to_fin`
- all those nested preset sources are `feature_ids`

### 6. Runtime migration

Runtime persistence now migrates:

- `legacy_approx -> historical_reference`

Project import/export now preserves:

- `releasableBoundaryVariantByTag`

and rebuilds scenario releasable overlays after import so the restored selection actually takes effect.

---

## Verification

Successful rebuild steps:

- `python3 tools/rebuild_reichskommissariat_reference_masks.py`
- `python3 tools/materialize_hoi4_reichskommissariat_boundaries.py`
- `python3 tools/build_hoi4_releasable_catalog.py`

Verified results:

- catalog validation errors: `0`
- `RKP`, `RKO`, `RKU`, `RKM` each expose exactly `hoi4` and `historical_reference`
- `RKP` exposes only `annexed_poland_to_ger`
- `RKM` exposes only `greater_finland_to_fin`
- materializer overlap audit remains clear for the default RK variants

Static runtime verification:

- `node --experimental-default-type=module --input-type=module` import check passed for:
  - `js/core/releasable_manager.js`
  - `js/core/file_manager.js`

Limit:

- no live browser sweep was run in this pass, so this QA verifies generator output, catalog output, audit output, and runtime import logic, but not full UI interaction via Playwright.

