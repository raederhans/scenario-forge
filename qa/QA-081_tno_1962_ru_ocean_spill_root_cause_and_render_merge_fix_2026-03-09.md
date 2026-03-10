# QA-081 TNO 1962 RU Ocean Spill Root Cause And Render Merge Fix

**Date**: 2026-03-09  
**Status**: Implemented and user-verified  
**Scope**: `TNO 1962` initial ocean redness, RU coastal/high-lat quick fill spill, and the final renderer-side completion fix  
**Constraints**: Minimal-impact repair; preserve existing scenario flow; avoid broad renderer behavior changes outside the faulty merge path

---

## 0) Executive Summary

This issue ended up having two separate layers:

1. A data-pipeline problem in the Russia runtime topology:
   - mixed coarse/detail RU topology plus shell fallback coverage could leak non-land fragments into political geometry
   - this produced the earlier "fill whole Russia" and "Russia plus ocean" behavior
2. A renderer problem that remained after the data rebuild:
   - `TNO 1962` uses the scenario political background merge path
   - that path merged same-owner and same-fill runtime fragments into a spherical artifact
   - the safety guard for suspicious merged shapes already existed, but it was only enabled for `hoi4_1936` and `hoi4_1939`

The final stable fix required both:

- full RU ADM2 runtime detail
- land-only shell repair
- refreshed runtime/scenario topology data
- generalized suspicious scenario background merge protection in the renderer

---

## 1) Symptom Timeline

### 1.1 Original Symptom

- In `TNO 1962`, quick fill on non-refined Siberian RU regions could spill into all of Russia and sometimes the ocean.
- In other scenarios, Russia did not always corrupt the ocean, but coarse RU areas could still produce oversized fill behavior.

### 1.2 After The Russia Data Rebuild

After rebuilding Russia as full ADM2 detail and clipping shell repair to land:

- inland Siberian RU quick fill stopped triggering the old "whole Russia" failure mode
- the big mixed coarse/detail fallback path was structurally removed

However, one symptom remained:

- `TNO 1962` could still open with the ocean already red before any interaction
- quick fill on some coastal/high-lat RU areas such as Kamchatka, Sakhalin, Primorye-side coastal regions, Chukotka-adjacent regions, and Arctic-facing fragments could still visually spill into the ocean

That was the decisive clue: the remaining bug existed at load time, so it was no longer a pure quick-fill targeting problem.

---

## 2) Root Cause Breakdown

### 2.1 Data-Layer Root Cause

The first root cause lived in the runtime political data pipeline:

- Russia previously used a hybrid coarse/detail composition
- some RU parent groups effectively collapsed into singleton fallback behavior
- shell coverage repair could restore missing RU shell fragments without first constraining the repair area to land

This created two bad outcomes:

1. quick fill on some RU groups could fall back to country-wide fill behavior
2. coastal fallback fragments could overlap water and make ocean spill visible

This part was fixed by:

- replacing RU with full ADM2 detail in `map_builder/processors/russia_ukraine.py`
- constraining shell repair to land in `map_builder/processors/detail_shell_coverage.py`
- rebuilding runtime/detail topology, hierarchy, migration data, and the `TNO 1962` scenario runtime payload

### 2.2 Why The First Fix Was Not Sufficient

The remaining red-ocean issue did **not** come from the same place.

Individual runtime features were already normalized on the renderer side before normal drawing. The remaining failure came from the scenario background optimization path in `js/core/map_renderer.js`:

- scenario mode groups runtime political fragments by `displayOwner + fillColor`
- the renderer calls `topojson.merge(...)` on each group
- the merged shape is then painted as a background fill before per-feature drawing

That merge step can produce a bad spherical polygon when the group contains high-lat, coastal, island-rich, or near-dateline fragments.

### 2.3 The Real Trigger Condition Behind The Remaining Spill

The trigger was **not** "this state has a special flag".

The real trigger condition was:

- a RU coastal/high-lat fragment joins a same-color scenario background merge group
- the merged group shape becomes suspicious on the sphere
- the merged result behaves like a giant inverted polygon or world-scale spill fill

That explains the observed pattern:

- inland Siberian states stopped failing after RU full-detail rebuild
- Pacific and Arctic-facing states could still appear to spill into the ocean
- `TNO 1962` could show a red ocean immediately on load because the bad merge group already existed before any click

### 2.4 Why TNO Was Still Broken While HOI4 Was Protected

The renderer already had a suspicious-merge guard, but it was scoped too narrowly:

- `shouldSkipScenarioPoliticalBackgroundMergeShape(...)` only applied the guard for `hoi4_1936` and `hoi4_1939`
- `TNO 1962` was therefore still allowed to render suspicious merged background shapes

So the remaining TNO bug was effectively a scenario-specific hole in an existing renderer safeguard.

---

## 3) Final Implementation

### 3.1 Data-Side Repairs

The Russia data pipeline was repaired as follows:

- RU was rebuilt as full ADM2 runtime detail
- RU city overrides were preserved
- shell repair was clipped to land-only allowed area
- runtime/detail topology was regenerated
- hierarchy and migration data were regenerated to eliminate old `RUS-*` coarse-group assumptions
- `TNO 1962` runtime scenario data was refreshed to align with the rebuilt RU runtime ids

### 3.2 Renderer-Side Completion Fix

The final renderer fix was intentionally small and local:

1. generalized the suspicious scenario background merge guard to all scenarios
2. added a world-bounds style check in addition to the area threshold
3. normalized the merged shape before deciding whether to render or skip it

Result:

- suspicious merged background shapes are skipped regardless of scenario id
- the renderer falls back to normal per-feature painting for those groups
- this preserves correctness even if a merge optimization becomes unstable

---

## 4) Changed Files

### 4.1 Data Pipeline

- `map_builder/processors/russia_ukraine.py`
- `map_builder/processors/detail_shell_coverage.py`
- `tools/build_na_detail_topology.py`
- `tools/build_runtime_political_topology.py`
- `tools/generate_hierarchy.py`
- `init_map_data.py`
- `data/europe_topology.na_v2.json`
- `data/europe_topology.runtime_political_v1.json`
- `data/hierarchy.json`
- `data/feature-migrations/by_hybrid_v1.json`
- `data/scenarios/tno_1962/*`

### 4.2 Renderer

- `js/core/map_renderer.js`

---

## 5) Verification Result

Final user-visible outcome:

- `TNO 1962` no longer opens with the ocean tinted red
- inland Siberian RU quick fill remains stable after the full-detail RU rebuild
- the remaining coastal/high-lat RU spill path was resolved by the scenario background merge guard generalization

This closed both halves of the problem:

1. bad RU runtime geometry composition
2. scenario background merge rendering a suspicious spherical result

---

## 6) Lessons For Future Work

- If a scenario already renders incorrectly before any click, inspect background passes before investigating interaction logic.
- High-lat, coastal, island-rich, and near-dateline geometries are the first candidates for spherical merge artifacts.
- A per-feature geometry fix is not enough if the renderer later merges those features into a new shape.
- Suspicious spherical merge guards should be scenario-agnostic unless there is a very explicit reason to scope them.
- Any future work touching RU runtime topology, shell repair, ring orientation, or scenario background merge should regression-test:
  - `TNO 1962`
  - `HOI4 1936`
  - `HOI4 1939`

