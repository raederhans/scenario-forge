# QA-084 TNO 1962 Scenario Coastline Source Gating

**Date**: 2026-03-11  
**Status**: Implemented and user-verified  
**Scope**: `TNO 1962` inland pseudo-coastline artifact, scenario coastline source diagnosis, renderer-side gating fix  
**Constraints**: Minimal renderer-only repair; no Python rebuilds; preserve scenario water/special overlays and existing political/border behavior

---

## 0) Executive Summary

This issue was initially investigated as an internal seam or border-pass defect.
Several renderer and topology experiments reduced some artifacts, but the
prominent inland dark lines remained.

The decisive user observation was correct:

- those lines were responding to the **coastline** style controls
- therefore they were not just border overlays or generic canvas seams

The final root cause was:

1. `TNO 1962` provides a scenario runtime topology with `context_land_mask`
2. the renderer, in `composite` mode, was allowing scenario runtime topology to
   drive the global coastline mesh
3. that scenario `context_land_mask` was pathological and contained a huge
   number of interior rings / hole boundaries
4. those hole boundaries were rendered by the coastline pass as if they were
   real coastlines

The final fix was renderer-side coastline source gating:

- default back to primary geography coastline
- only allow scenario coastline takeover when the runtime land mask passes
  conservative quality checks

For `TNO 1962`, the runtime mask fails those checks and now falls back to the
primary coastline source.

---

## 1) Symptom Progression

### 1.1 Initial Symptom

- Dense black crack-like lines appeared across inland regions, especially in
  `TNO 1962`
- Most visible in Eastern Europe and other fine-detail scenario regions
- Prior fixes aimed at:
  - internal border LOD
  - same-color seam strokes
  - scenario underpaint fallback

These reduced some artifacts but did not eliminate the most obvious inland dark
lines.

### 1.2 Key User Finding

The turning point was direct user validation:

- adjusting the **coastline** width/style changed the width of the inland dark
  lines

That immediately narrowed the problem:

- these lines had entered the coastline render pass
- they were not only internal borders
- they were not only canvas anti-aliasing seams

---

## 2) Root Cause

### 2.1 Why the earlier seam diagnosis was incomplete

The earlier seam analysis was partially correct but incomplete:

- canvas seam behavior exists
- internal border meshes can amplify dark lines
- scenario background merge fallback matters for fill continuity

However, those were not the dominant cause of the remaining inland lines in
`TNO 1962`.

### 2.2 The actual coastline path

In `js/core/map_renderer.js`, `rebuildStaticMeshes()` was selecting a unified
topology source for country borders and coastlines:

- in `composite` mode, this could point at `state.runtimePoliticalTopology`

Then `buildGlobalCoastlineMesh(...)` attempted coastline extraction from:

1. `land_mask`
2. `land`
3. fallback political outer boundary logic

For scenario runtime topology, this meant the coastline pass could be driven by
scenario runtime land-mask objects instead of the stable primary geography.

### 2.3 Why TNO specifically failed

Unlike the base runtime file, `TNO 1962` scenario runtime topology includes:

- `context_land_mask`
- `land_mask`
- `land`
- `scenario_water`
- `scenario_special_land`

Browser-side diagnostics showed that `TNO`'s `context_land_mask` was extremely
bad for coastline use:

- `runtimeObjectName`: `context_land_mask`
- `runtimeFeatureCount`: `1`
- `runtimePolygonPartCount`: `2464`
- `runtimeInteriorRingCount`: `30050`
- `runtimeInteriorRingRatio`: `12.1956`
- `areaDeltaRatio`: `3.4662`
- `reason`: `runtime_world_bounds`

This means the scenario land mask effectively encoded thousands of inland hole
boundaries. The coastline pass drew those as coastlines.

### 2.4 Why 1936 / 1939 did not show the same failure

`HOI4 1936` and `HOI4 1939` did not produce the same visible defect because
they were not successfully handing coastline generation over to an equally bad
scenario land mask in the same way.

The important distinction is not merely "scenario active vs inactive", but
whether a scenario runtime coastline source is both present and geometrically
usable.

---

## 3) Implemented Fix

### 3.1 Renderer-side coastline source gating

Implemented in `js/core/map_renderer.js`:

- added a dedicated coastline source resolver
- primary geography is now the default coastline source
- scenario runtime topology may only override it if its land-mask metrics pass
  conservative quality gates

### 3.2 Gating inputs and rules

Scenario coastline source evaluation now checks runtime topology objects in this
order:

1. `context_land_mask`
2. `land_mask`
3. `land`

Computed metrics include:

- decoded feature count
- polygon part count
- interior ring count
- total spherical area
- world-bounds detection
- area delta ratio versus primary land source

Scenario coastline is rejected when any of the following are true:

- runtime mask resolves to world bounds
- area delta ratio is too large
- total interior ring count exceeds the cap
- interior-ring-to-polygon-part ratio is abnormally high

### 3.3 Resulting TNO decision

For `TNO 1962`, runtime coastline is now rejected and the renderer logs:

`Scenario coastline source primary: scenario=tno_1962 reason=runtime_world_bounds ...`

That means:

- the global coastline mesh is again sourced from primary geography
- scenario water / special overlays still remain available as scenario context
- inland hole boundaries from the broken scenario land mask no longer enter the
  coastline pass

---

## 4) Files Changed

- `js/core/map_renderer.js`

No Python build scripts or scenario assets were modified for this repair.

---

## 5) Evidence

### 5.1 Browser comparison artifacts

- [hoi4_1936-fullmap.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/scenario-compare/hoi4_1936-fullmap.png)
- [hoi4_1939-fullmap.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/scenario-compare/hoi4_1939-fullmap.png)
- [tno_1962-fullmap.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/scenario-compare/tno_1962-fullmap.png)
- [tno_1962-coastline-gated-fullmap.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/scenario-compare/tno_1962-coastline-gated-fullmap.png)

### 5.2 Console evidence after fix

Relevant console log:

- [console-2026-03-11T23-40-58-035Z.log](/C:/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-11T23-40-58-035Z.log)

Important entries:

- `Scenario coastline source primary: scenario=tno_1962 reason=runtime_world_bounds ...`
- existing `Scenario political background merge fallback engaged ...`
- unrelated `favicon.ico` 404

### 5.3 Runtime diagnostic snapshot

Browser-side `__mapCoastlineDiag` after fix:

- `source`: `primary`
- `reason`: `runtime_world_bounds`
- `runtimeObjectName`: `context_land_mask`
- `runtimeInteriorRingCount`: `30050`
- `runtimeInteriorRingRatio`: `12.195616883116884`
- `areaDeltaRatio`: `3.4662354250540566`

These values are far beyond what is acceptable for a coastline-driving mask.

---

## 6) Validation Outcome

Validation completed:

- `node --check js/core/map_renderer.js` passed
- browser loaded successfully after the change
- no new JavaScript execution errors were introduced
- the coastline decision path is now explicit and observable
- user confirmed the problematic inland coastline-like lines are gone

---

## 7) Lessons Learned

- If a visual artifact responds to a specific style control, trust that signal
  first; it is often more reliable than an indirect architectural guess.
- Scenario runtime topology should not be allowed to silently replace global
  coastline sources without quality validation.
- `context_land_mask` is especially dangerous when it is generated for clipping
  or context isolation rather than for cartographic coastline rendering.
- Renderer-side source gating is an effective containment fix when the upstream
  scenario topology is known-bad but a rebuild is not yet justified.
- If future work revisits this area, the next optional improvement is upstream:
  repair or regenerate scenario `land_mask/context_land_mask` so that the
  renderer can eventually accept scenario coastline sources safely.
