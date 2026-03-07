# QA-059: HOI4 Reichskommissariat Boundary Revalidation And Historical Transfers

> Superseded by `QA-060_reichskommissariat_feature_mask_rebuild_2026-03-06.md`.
> QA-059 remains useful for the first HOI4-trigger revalidation pass, but its implementation notes are no longer the current source of truth because the project has since moved from mixed whole-group approximations to explicit feature masks.

**Date**: 2026-03-06
**Severity**: HIGH
**Scope**: `RKP`, `RKO`, `RKU`, `RKM` releasable boundaries and releasable-specific historical transfer actions
**Supersedes**: QA-056

---

## Summary

This pass revalidated the Reichskommissariat boundary logic against the current HOI4 scripted triggers and updated the app implementation accordingly.

Implemented result:

- `RKP`, `RKO`, `RKU`, `RKM` now expose `HOI4` and `Current Approx` boundary variants.
- The default releasable core territory for those four tags now follows the selected boundary variant.
- `RKP` now exposes a separate historical transfer action that gives the German-annexed western Polish belt to `GER`.
- `RKM` now exposes a separate historical transfer action that gives a medium-line Greater Finland approximation to `FIN`.
- Default HOI4 variants no longer overlap each other in the generated audit output.

---

## Revalidation Findings

### 1. QA-056 was directionally useful but no longer fully correct

The current runtime topology and current HOI4 trigger set invalidate several older assumptions:

- The previously flagged explicit fringe IDs are not phantom in the current runtime topology.
- `RKM` should keep `BY_Grodno` and `BY_Vitebsk` under an HOI4-first interpretation.
- `RKM` should not be shrunk simply by an A-A line heuristic when HOI4 still includes the corresponding states.
- `RKP` should not absorb the German-annexed western Polish belt into its default boundary.

### 2. The real default-boundary corrections are now:

- `RKP`: HOI4-first GG proxy with Galicia added, while German-annexed western Polish areas are excluded from the default releasable fill.
- `RKO`: Grodno and Vitebsk removed from the default Ostland proxy; Brest and Minsk retained.
- `RKU`: legacy full-`UA_Sumy` overreach removed from the default HOI4 proxy; explicit fringe districts remain.
- `RKM`: retains Grodno, Vitebsk, and the southern/eastern HOI4 depth, but now excludes the two `RKU` fringe features that caused the old inter-RK overlap.

---

## Implemented Changes

### Data / generation

- `data/releasables/hoi4_reichskommissariat_boundaries.internal.json`
  - four Reichskommissariat entries now define:
    - `default_boundary_variant_id`
    - `boundary_variants[]`
    - `companion_actions[]` where applicable
- `tools/materialize_hoi4_reichskommissariat_boundaries.py`
  - now materializes boundary variants and companion actions into resolved `feature_ids`
  - mirrors the default variant back into top-level `preset_source`
  - emits overlap diagnostics for default HOI4 variants
- `tools/build_hoi4_releasable_catalog.py`
  - now carries the new schema into the catalog and validates nested variants/actions

### Runtime / UI

- `js/core/releasable_manager.js`
  - now resolves releasable core territory from the selected boundary variant
  - stores per-tag selected boundary variant state
  - exposes companion-action feature resolution
- `js/ui/sidebar.js`
  - scenario releasable inspector now shows:
    - `Boundary Variants`
    - `Historical Transfers` where present
  - changing a boundary variant rebuilds the releasable core preset and reapplies it immediately
  - historical transfer buttons use the existing ownership batch application path

### Historical transfer actions added

- `RKP -> GER`
  - `Apply German-Annexed Polish Provinces`
  - transfers the western/central Polish annexation belt without creating `Wartheland`, `DNZ`, or `SIL`
- `RKM -> FIN`
  - `Transfer West Karelia / West Kola To Finland`
  - transfers `RU_Karelia` plus restrained Murmansk/Ladoga fringe subsets

---

## Verification

Generated outputs after implementation:

- `data/releasables/hoi4_vanilla.internal.phase1.source.json`
- `data/releasables/hoi4_vanilla.internal.phase1.catalog.json`
- `reports/generated/releasables/hoi4_reichskommissariat_boundaries.audit.json`
- `reports/generated/releasables/hoi4_reichskommissariat_boundaries.audit.md`

Verified conditions:

- `RKP`, `RKO`, `RKU`, `RKM` all materialize both `hoi4` and `legacy_approx`.
- `RKP` catalog entry includes `annexed_poland_to_ger`.
- `RKM` catalog entry includes `greater_finland_medium_to_fin`.
- Generated audit reports zero default-HOI4 overlaps after removing the `RKM` / `RKU` `Taganrog` + `Liski` collision.

Verification limit:

- Playwright MCP transport was unavailable during this pass, so no live browser screenshot sweep was completed.
- Validation therefore consists of generator success, catalog success, JSON inspection, and static runtime wiring review.
