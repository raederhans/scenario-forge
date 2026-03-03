# QA-044 — Boundary Gap Fix: Admin0 Background Fill + Fill-Colored Stroke

**Date**: 2026-03-03
**Scope**: Visual gap elimination between adjacent features with mismatched subdivision levels
**Status**: Plan approved, pending implementation

---

## Problem Statement

When adjacent countries have different levels of administrative subdivision (e.g., China ADM2 cities vs. Vietnam admin0, Russia ADM2 west vs. admin1 east), their shared boundaries may not perfectly align. This produces small visual gaps that expose the ocean/background layer beneath.

**Root cause**: Features from different source datasets (Natural Earth admin0, geoBoundaries ADM2, national statistical agencies) have independently defined boundary coordinates. Even after TopoJSON arc sharing, some edges remain unshared because the source geometries trace slightly different paths.

**Affected scenarios**:
| Scenario | Example | Gap Type |
|----------|---------|----------|
| Subdivided country vs. non-subdivided neighbor | China provinces vs. Vietnam | International boundary |
| Dual-precision within same country | Russia ADM2 (west) vs. admin1 (east) | Internal boundary |
| Different admin1 sources | Natural Earth vs. geoBoundaries | Both |
| Anti-aliasing artifacts | Any adjacent feature pair | Sub-pixel seam |

---

## Chosen Approach: A + B Combined

Two complementary runtime rendering fixes. No topology data changes required.

### Fix B: Fill-Colored Stroke (Anti-aliasing coverage)

**What**: After each `context.fill()` call in the per-feature loop, add a thin stroke in the same color as the fill. This expands each feature by ~0.25px outward, covering sub-pixel anti-aliasing seams.

**Where**: `js/core/map_renderer.js` — `drawCanvas()` function, inside the `state.landData.features.forEach()` loop (currently lines 3804-3807).

**Current code**:
```javascript
context.beginPath();
pathCanvas(feature);
context.fillStyle = fillColor;
context.fill();
```

**Modified code**:
```javascript
context.beginPath();
pathCanvas(feature);
context.fillStyle = fillColor;
context.fill();
context.strokeStyle = fillColor;
context.lineWidth = 0.5 / k;
context.lineJoin = "round";
context.stroke();
```

**Notes**:
- `0.5 / k` ensures the stroke is 0.5 CSS pixels regardless of zoom level
- `lineJoin = "round"` prevents sharp miter artifacts at polygon corners
- Only applied in `PROD` debug mode (the normal rendering path)
- Performance impact: negligible (stroke reuses the same path already in the context)

---

### Fix A: Admin0 Background Fill Layer (Structural gap coverage)

**What**: Before drawing individual admin1/admin2 features, render a merged admin0 silhouette per country as a solid background fill. Any gaps between subdivisions are hidden by the country-level shape underneath.

**Where**: `js/core/map_renderer.js` — new function `drawAdmin0BackgroundFills(k)` called in `drawCanvas()`, inserted between ocean drawing (line 3766) and the per-feature loop (line 3769).

#### Implementation Detail

**1. Cache structure** (module-level):
```javascript
let admin0MergedCache = {
  topologyRef: null,
  featureCount: 0,
  entries: [],       // [{ code, mergedShape }]
};
```

**2. New function** `buildAdmin0MergedShapes()`:
```javascript
function buildAdmin0MergedShapes() {
  // Determine which topology object contains the political geometries
  const topology = state.topologyPrimary || state.topology;
  if (!topology?.objects?.political || !globalThis.topojson?.merge) return [];

  const geometries = topology.objects.political.geometries || [];
  const currentFeatureCount = state.landData?.features?.length || 0;

  // Check cache validity
  if (
    admin0MergedCache.topologyRef === topology &&
    admin0MergedCache.featureCount === currentFeatureCount
  ) {
    return admin0MergedCache.entries;
  }

  // Group geometries by country code
  const byCountry = new Map();
  geometries.forEach((geom) => {
    const code = String(geom?.properties?.cntr_code || "").trim().toUpperCase();
    if (!code) return;
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code).push(geom);
  });

  // Merge each country's geometries into a single polygon
  const entries = [];
  byCountry.forEach((geoms, code) => {
    try {
      const mergedShape = globalThis.topojson.merge(topology, geoms);
      entries.push({ code, mergedShape });
    } catch (e) {
      // Skip countries that fail to merge (shouldn't happen)
      console.warn(`Admin0 merge failed for ${code}:`, e);
    }
  });

  // Update cache
  admin0MergedCache = { topologyRef: topology, featureCount: currentFeatureCount, entries };
  return entries;
}
```

**3. New function** `drawAdmin0BackgroundFills(k)`:
```javascript
function drawAdmin0BackgroundFills(k) {
  const entries = buildAdmin0MergedShapes();
  if (!entries.length) return;

  entries.forEach(({ code, mergedShape }) => {
    // Resolve country base color
    const color =
      (state.sovereignBaseColors && state.sovereignBaseColors[code]) ||
      (state.countryBaseColors && state.countryBaseColors[code]) ||
      null;

    // If no country color assigned, use LAND_FILL_COLOR as fallback
    const fillColor = getSafeCanvasColor(color, null) || LAND_FILL_COLOR;

    context.beginPath();
    pathCanvas(mergedShape);
    context.fillStyle = fillColor;
    context.fill();
  });
}
```

**4. Integration in `drawCanvas()`** — insert call at line 3768:
```javascript
  // 3. Draw ocean
  // ... (existing ocean code) ...
  drawOceanStyle();

  // 3.5 Draw admin0 background fills to cover subdivision gaps (NEW)
  if (debugMode === "PROD") {
    drawAdmin0BackgroundFills(k);
  }

  // 4. Draw political land fill first.
  if (state.landData?.features?.length) {
    // ... (existing per-feature loop) ...
```

#### Draw Order (Final)

```
1. Clear canvas
2. Apply zoom transform
3. Draw ocean (sphere + ocean data + ocean style)
3.5 Draw admin0 background fills (NEW) ← covers structural gaps
4. Draw per-feature fills (existing) ← with fill-colored stroke (Fix B)
5. Draw texture overlays
6. Draw context layers (physical, urban, rivers)
7. Draw border hierarchy (country > province > local)
```

#### Edge Cases

| Case | Handling |
|------|----------|
| Country has no assigned color yet | Falls back to `LAND_FILL_COLOR` (#f0f0f0) — neutral gray |
| Country only exists in detail topology, not primary | The primary topology still contains all countries; merge operates on the primary |
| Runtime political topology (composite mode) | Use `state.topologyPrimary \|\| state.topology` — works for both modes |
| Sovereignty overrides change country colors | Background uses `sovereignBaseColors` which tracks sovereignty assignments |
| Non-PROD debug modes | Background fills are skipped (only drawn in PROD mode) |
| Topology reloaded | Cache invalidated by `topologyRef` and `featureCount` checks |

#### Performance

- **`topojson.merge()`**: Runs once per topology load, not per frame. ~200 merge calls for ~200 countries. Typically < 50ms total.
- **Drawing**: ~200 `context.fill()` calls per frame — negligible vs. existing 11,000+ feature draws.
- **Memory**: Cache stores ~200 GeoJSON shapes. Minimal footprint.

---

## What This Does NOT Fix

1. **Genuine territorial disputes**: Where two countries claim overlapping territory, the topology itself must define the overlap. This fix is purely visual gap coverage.
2. **Topology quality issues**: If a country's own subdivisions have internal overlaps or self-intersections, those are data bugs that need fixing in the build pipeline.
3. **Zoom-dependent artifacts**: At extreme zoom levels (>20x), sub-pixel precision limits may still produce occasional flickering. This is a Canvas rendering limitation.

---

## Testing Plan

1. **Visual inspection**: Pan/zoom across known gap locations:
   - China-Vietnam border
   - China-Myanmar border
   - Russia internal (Kaliningrad, Caucasus region)
   - France-Spain border
   - US-Canada border
   - India-Pakistan border

2. **Performance check**: Confirm no framerate drop during pan/zoom interaction.

3. **Color correctness**: Verify the admin0 background color matches the visible per-feature colors (no color bleeding through gaps).

4. **Debug modes**: Confirm background fills are disabled in GEOMETRY, ARTIFACTS, ISLANDS, ID_HASH modes.

5. **Sovereignty changes**: After reassigning sovereignty for a country, verify the background fill updates to match the new color.

---

## Files to Modify

| File | Change |
|------|--------|
| `js/core/map_renderer.js` | Add `admin0MergedCache`, `buildAdmin0MergedShapes()`, `drawAdmin0BackgroundFills()`, modify `drawCanvas()` draw order, add fill-colored stroke in per-feature loop |

**Estimated effort**: ~1 hour implementation + testing

---

## Alternative Approaches Considered (Not Chosen)

### C: Build-Time Topology Alignment
- Use mapshaper `-snap interval=0.0001 -clean` in the Python build pipeline to align boundaries from different source datasets at build time.
- **Why not**: Requires full topology rebuild; may distort intentionally different boundaries; doesn't help with future data updates unless always applied. Can be added later as a complementary improvement.

### B-only: Fill-Colored Stroke Alone
- **Why not**: Only fixes anti-aliasing seams (sub-pixel gaps). Does not cover genuinely misaligned boundaries from different source data, which are the primary complaint.

### Canvas Compositing (`destination-over`)
- Draw merged land mass behind features using `globalCompositeOperation = "destination-over"`.
- **Why not**: Uses a single neutral color for all gaps, which may be visible through anti-aliased edges as a thin line of wrong color between differently-colored features. The per-country admin0 approach (Fix A) uses the correct country color.

### SVG `shape-rendering: crispEdges`
- **Why not**: Produces jagged pixelated edges — unacceptable for cartographic quality. Only applies to SVG layer, not Canvas.
