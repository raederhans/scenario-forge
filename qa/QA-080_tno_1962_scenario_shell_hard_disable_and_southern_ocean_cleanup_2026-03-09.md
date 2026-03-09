# QA-080 TNO 1962 Scenario Shell Hard Disable And Southern Ocean Cleanup (2026-03-09)

## Summary
- Goal: archive the current fix round for the remaining `tno_1962` shell / southern-ocean / Crimea / RU Far East leakage issues.
- Result:
  - scenario runtime shell overlays are now hard-disabled
  - `AQ_* antarctic_sector` runtime geometries are now treated as non-political and excluded from interaction/render aggregation
  - sovereignty seeding and sidebar ownership/preset paths no longer treat shell / antarctic-sector ids as valid visible targets
- Scope was intentionally limited to runtime behavior:
  - no scenario bundle schema changes
  - no edits to `data/scenarios/tno_1962/*` were required for the code-side fix

## Root Cause
### 1. Scenario shell overlays were still live
- [scenario_manager.js](../js/core/scenario_manager.js) still recomputed `_FB_` shell owner/controller mappings from runtime neighbors on:
  - scenario activation
  - scenario reset
  - sidebar companion actions
- That meant shell semantics could still re-enter ownership/frontline display even after renderer-side de-prioritization.

### 2. Southern Ocean was not actually a water-layer bug
- `tno_1962` runtime political topology still contains:
  - `416` `_FB_` shell geometries
  - `11` `AQ_* antarctic_sector` giant geometries
- The critical miss was that many `AQ_* antarctic_sector` runtime geometries do **not** carry a populated `countryCode`, so a strict `countryCode === "AQ"` check did not catch them.
- Result:
  - giant south-polar political wedges could still be rendered or targeted
  - Southern Ocean could still inherit political color instead of plain ocean background

### 3. Non-renderer write paths still accepted shell / AQ ids
- Renderer-side filtering alone was insufficient because non-renderer paths still treated shell/AQ ids as normal visible features:
  - sovereignty seeding
  - owner index rebuilding
  - sidebar preset / companion action target filtering
- That left a path for:
  - RU Far East quick-fill leakage
  - Crimea transfers dirtying shell-backed geometry even when shells were no longer supposed to display

## Patch Summary
### 1. Hard-disable scenario shell overlays
- File: [scenario_manager.js](../js/core/scenario_manager.js)
- Changes:
  - added `isScenarioShellOverlayEnabled()` and fixed it to `false`
  - `refreshScenarioShellOverlays()` now remains callable but keeps shell maps empty
  - `getScenarioDisplayOwnerByFeatureId()` no longer falls back to shell owner/controller semantics

### 2. Exclude shell and antarctic-sector geometry from political interaction/render
- File: [map_renderer.js](../js/core/map_renderer.js)
- Changes:
  - `isAntarcticSectorFeature()` now recognizes runtime `AQ_*` + `detail_tier=antarctic_sector` even when `countryCode` is absent
  - shell / antarctic-sector geometry is excluded from:
    - political owner display resolution
    - owner border grouping
    - hit canvas and grid hit candidates
    - land spatial index participation
    - merged scenario political background
    - political pass drawing
    - country/parent batch fill targeting
  - `resolveInteractionTargetIds()` now refuses excluded political features
  - `getCountryFeatureIds()` now filters out excluded political features defensively

### 3. Remove shell / AQ ids from sovereignty and sidebar write paths
- Files:
  - [sovereignty_manager.js](../js/core/sovereignty_manager.js)
  - [sidebar.js](../js/ui/sidebar.js)
- Changes:
  - sovereignty seed and owner-index rebuild now skip shell / antarctic-sector ids
  - direct ownership writes now reject excluded ids
  - sidebar `filterToVisibleFeatureIds()` now filters excluded ids out instead of only checking `landIndex.has(id)`
  - sidebar batch ownership apply now uses the filtered target set, so presets / companion transfers cannot silently write shell/AQ features

## Validation
- Static checks run:
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/scenario_manager.js`
  - `node --check js/core/sovereignty_manager.js`
  - `node --check js/ui/sidebar.js`
  - `git diff --check -- js/core/map_renderer.js js/core/scenario_manager.js js/core/sovereignty_manager.js js/ui/sidebar.js`
- Result:
  - all syntax checks passed
  - `git diff --check` reported only CRLF warnings, no whitespace or syntax errors

## Manual Recheck Targets
- `tno_1962` ownership view:
  - Southern Ocean should revert to uniform ocean background
- `tno_1962` frontline view:
  - no remaining AQ sector wedges
- RU Far East quick fill:
  - Primorsky Krai
  - Kamchatka
  - Sakhalin
  - Sakha
  - Chita
  - Irkutsk
  - expected: no spill into shell geometry or ocean
- Crimea:
  - peninsula base fill and Sevastopol should no longer show dirty GER-over-SOV overlap

## Notes
- This round intentionally prefers “correct but without shell patch-up geometry” over “visually patched but politically wrong”.
- If minor visual holes appear after shell hard-disable, they should be treated as a separate follow-up and not solved by re-enabling shell ownership semantics.
