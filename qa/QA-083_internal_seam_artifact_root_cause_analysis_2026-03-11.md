# QA-083: Internal Seam Artifact Root Cause Analysis

**Date:** 2026-03-11
**Status:** Root cause identified, fix plan proposed
**Severity:** Visual — high-impact cosmetic defect at medium/high zoom

---

## Problem Statement

When zoomed into the map, ugly dark scratch-like lines appear densely between
sub-national features (NUTS-3, admin-1, etc.) within countries. Most prominent
in feature-dense countries: Germany, Poland, Ukraine, Russia. The lines look
like dirt or damage rather than clean borders.

Two rounds of agent-driven fixes have been attempted (pending changes in
`local_canonicalization.py`, `build_na_detail_topology.py`,
`build_runtime_political_topology.py`, `detail_shell_coverage.py`). These
changes have **not produced visible improvement**.

---

## Analysis of Pending Changes

### What the changes do

| File | Purpose |
|------|---------|
| `map_builder/geo/local_canonicalization.py` (new) | Rebuilds per-country sub-topologies with `shared_coords=True` and coordinate snapping to 6 decimal places |
| `tools/build_na_detail_topology.py` | Adds canonicalization step after patching, before final topology build |
| `tools/build_runtime_political_topology.py` | Adds canonicalization step after feature composition, before final topology build |
| `init_map_data.py` | Adds candidate promotion gate with quality metrics |
| `map_builder/processors/detail_shell_coverage.py` | Adds Ukraine shell coverage spec |

### Why these changes don't produce visible improvement

**Reason 1: The changes operate on the wrong layer of the problem.**

The seam artifacts are a **Canvas 2D rendering problem**, not a topology data
problem. The canonicalization improves arc sharing in the TopoJSON data, but the
visual seams are created during rasterization in the browser. No amount of
geometry cleanup will fix a rendering-layer issue.

**Reason 2: Canonicalized geometry gets re-quantized.**

The canonicalization happens mid-pipeline, but the geometries then pass through
a SECOND `build_topology()` / `build_political_only_topology()` call with
quantization parameters (100,000). This second quantization can break the
carefully aligned shared boundaries that canonicalization established.

**Reason 3: The build pipeline hasn't been re-run.**

Even if the code changes were effective, the topology JSON files in `data/` are
pre-built artifacts. Unless `init_map_data.py` was re-run after these code
changes, the browser is still loading unchanged topology data.

---

## Root Cause: Three Overlapping Issues

### Issue 1 (Primary): Canvas Anti-Aliasing Gaps

**This is the main cause of the ugly seam lines.**

When the HTML Canvas 2D API draws two adjacent filled polygons:

```
context.beginPath();
pathCanvas(featureA);     // polygon A
context.fill();

context.beginPath();
pathCanvas(featureB);     // adjacent polygon B
context.fill();
```

The anti-aliaser creates semi-transparent edge pixels on each polygon. Where
polygon A and polygon B share a boundary, **neither polygon fully covers the
boundary pixels**. The result: the background color (ocean blue or whatever was
drawn previously) bleeds through as a 1-pixel dark seam.

This is an inherent limitation of the Canvas 2D API when drawing adjacent filled
shapes independently.

**Location:** `js/core/map_renderer.js` lines 7379-7382 (`drawPoliticalPass`)

### Issue 2 (Exacerbating): Internal Border Strokes Drawn Over Seams

The border rendering pass draws `localBorders` and `detailAdmBorders` on TOP
of the already-visible anti-aliasing seams:

```
// At zoom >= 2.0: local borders (alpha 0.22-0.48, color #cccccc)
drawMeshCollection(state.cachedLocalBorders, internalColor, localWidth);

// At zoom >= 2.4: detail admin borders (alpha 0.24-0.34, color #888888)
drawMeshCollection(state.cachedDetailAdmBorders, DETAIL_ADM_BORDER_COLOR, detailAdmWidth);
```

These semi-transparent gray strokes overlay the dark anti-aliasing gaps,
creating a denser, more prominent seam appearance than either issue alone.

**Location:** `js/core/map_renderer.js` lines 5013-5023 (`drawHierarchicalBorders`)

### Issue 3 (Partial): Background Fill Color Mismatch

The existing mitigation `drawAdmin0BackgroundFills()` draws a merged country
shape underneath individual features. However:

- It uses **one color per country** (`state.sovereignBaseColors[code]` or
  `state.countryBaseColors[code]`)
- Individual features have **different shades** from the palette
- At seams, the single background color peeks through — it's not ocean-dark,
  but it's a **different shade** from either adjacent feature

This means the anti-aliasing gap reveals a third color (the country base color)
rather than matching either neighbor.

**Location:** `js/core/map_renderer.js` lines 7299-7316 (`drawAdmin0BackgroundFills`)

### Issue 4 (Conditional): Matching Stroke Disabled in Scenario Mode

The code has a matching-color stroke mitigation (stroke each feature in its
own fill color to cover anti-alias artifacts):

```javascript
if (debugMode === "PROD") {
  if (!useScenarioBackgroundMerge || isAtlantropaSea) {   // <-- conditional!
    context.strokeStyle = fillColor;
    context.lineWidth = 0.5 / k;
    context.lineJoin = "round";
    context.stroke();
  }
}
```

This stroke is **skipped** when `useScenarioBackgroundMerge` is true, leaving
seams completely unmitigated in scenario mode.

**Location:** `js/core/map_renderer.js` lines 7384-7392

---

## Render Pass Order (for reference)

```
1. background    → ocean fill
2. political     → drawAdmin0BackgroundFills() + individual feature fills + optional matching strokes
3. effects       → textures, hachure
4. contextBase   → physical features, rivers
5. contextScenario → scenario context
6. dayNight      → day/night overlay
7. borders       → local, province, detail admin, parent, country, coastline strokes
```

The key observation: **borders (pass 7) are drawn AFTER political fills (pass 2)**,
so border strokes overlay the already-visible anti-aliasing gaps.

---

## Proposed Fix Plan

### Fix A: Always Draw Matching Strokes (immediate, rendering-side)

In `drawPoliticalPass`, remove the `!useScenarioBackgroundMerge` guard and
always draw a matching-color stroke on every feature:

```javascript
// ALWAYS draw matching stroke to cover anti-aliasing seams
context.strokeStyle = fillColor;
context.lineWidth = 0.75 / k;    // slightly thicker than current 0.5
context.lineJoin = "round";
context.stroke();
```

**Effort:** ~5 lines changed
**Impact:** Covers most visible seams in both normal and scenario mode

### Fix B: Suppress Internal Borders at Dense Zoom Levels (immediate)

Raise `LOCAL_BORDERS_MIN_ZOOM` and `DETAIL_ADM_BORDERS_MIN_ZOOM` thresholds,
or reduce their alpha further, so they don't exacerbate the seam appearance:

```javascript
const LOCAL_BORDERS_MIN_ZOOM = 3.0;       // was 2.0
const DETAIL_ADM_BORDERS_MIN_ZOOM = 3.5;  // was 2.4
```

Or make them configurable via style config so users can tune them.

### Fix C: Per-Country Group Rendering (medium-term)

For each country, collect all features into a single Canvas path before filling:

```javascript
// Group features by country
const byCountry = groupByCountryCode(state.landData.features);
byCountry.forEach((features, countryCode) => {
  context.beginPath();
  features.forEach(f => pathCanvas(f));
  context.fillStyle = countryBaseColor;   // single color per country
  context.fill();                         // one fill() call = no internal seams
});
// Then draw individual feature overlays for color variation
```

This eliminates internal seams entirely for same-country features, at the cost
of requiring a two-pass approach for per-feature color variation.

### Fix D: Overdraw with Slight Expansion (medium-term)

Before filling each feature, draw a slightly expanded version (0.5px larger)
in the same fill color, then draw the precise fill on top. This ensures
adjacent features overlap at their shared boundary.

```javascript
context.beginPath();
pathCanvas(feature);
context.fillStyle = fillColor;
context.lineWidth = 1.0 / k;
context.strokeStyle = fillColor;
context.stroke();         // stroke first (slightly expands coverage)
context.fill();           // fill on top (precise boundary)
```

### Fix E: Use `globalCompositeOperation` to Prevent Bleed-Through (experimental)

After drawing the background fills, set the composite mode to prevent the
background from showing through seams:

```javascript
context.globalCompositeOperation = "destination-over";
// ... draw features ...
context.globalCompositeOperation = "source-over";
```

This requires careful ordering and may have side effects with transparency.

---

## Recommended Immediate Actions

1. **Apply Fix A** — always draw matching strokes (highest impact, minimal risk)
2. **Apply Fix B** — raise internal border zoom thresholds (reduces visual density)
3. **Consider reverting the pending Python changes** — they add complexity to the
   build pipeline without addressing the actual visual problem
4. **Re-run the build** if retaining the Python changes, to see if arc sharing
   metrics actually improve

---

## Summary Table

| Factor | Impact on Seams | Fixed by Pending Changes? |
|--------|----------------|--------------------------|
| Canvas anti-aliasing gaps | **Primary cause** | No |
| Internal border overlays | Exacerbates | No |
| Background color mismatch | Partial | No |
| Matching stroke disabled in scenario | Conditional | No |
| Arc sharing in topology | Indirect (border detection) | Partially |
| Coordinate snapping | Indirect (sub-pixel alignment) | Partially |

**Conclusion:** The visible seam problem is a rendering-pipeline issue.
The pending build-pipeline changes improve data quality but do not address
the root cause. Fix A (always draw matching strokes) is the highest-impact
single change.
