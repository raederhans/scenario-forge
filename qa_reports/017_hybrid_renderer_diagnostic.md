# QA-017: Hybrid Canvas+SVG Renderer — Diagnostic Injection Script

**Date:** 2026-02-06
**Target:** `js/core/map_renderer.js`
**Bugs Under Investigation:**
1. **Invisible Ocean** — ocean layer not rendering on Canvas
2. **Broken Auto-Fill** — political mode paints almost all countries the same fallback color

---

## Diagnostic Code — Injection Points

### INJECTION POINT 1: Inside `initMap()`, after line 954 (`render();`)

Paste the following block **at the very end of `initMap()`**, just before the closing `}`:

```javascript
// ══════════════════════════════════════════════════════════════
// DIAGNOSTIC BLOCK 1: Post-Init Data Integrity Audit
// ══════════════════════════════════════════════════════════════
console.group("🔍 DIAG-1: Post-Init Data Integrity");

// 1A: Topology root check
console.log("topology exists:", !!state.topology);
console.log("topology.objects keys:", state.topology?.objects ? Object.keys(state.topology.objects) : "MISSING");

// 1B: Ocean object in topology
const topoOcean = state.topology?.objects?.ocean;
console.log("topology.objects.ocean exists:", !!topoOcean);
console.log("topology.objects.ocean.type:", topoOcean?.type);
console.log("topology.objects.ocean.geometries count:", topoOcean?.geometries?.length ?? "N/A");

// 1C: Converted oceanData (GeoJSON)
console.log("state.oceanData exists:", !!state.oceanData);
console.log("state.oceanData type:", state.oceanData?.type);
if (state.oceanData?.type === "FeatureCollection") {
  console.log("state.oceanData.features count:", state.oceanData.features?.length);
  if (state.oceanData.features?.length > 0) {
    const firstOceanFeature = state.oceanData.features[0];
    console.log("First ocean feature geometry type:", firstOceanFeature?.geometry?.type);
    console.log("First ocean feature coords ring count:", firstOceanFeature?.geometry?.coordinates?.length);
    // Check if the polygon is degenerate (empty or single-point)
    const firstRing = firstOceanFeature?.geometry?.coordinates?.[0];
    console.log("First ocean feature first ring point count:", firstRing?.length ?? 0);
    if (firstRing?.length > 0) {
      console.log("First ocean feature bbox sample [0]:", firstRing[0]);
    }
  }
} else if (state.oceanData?.type === "Feature") {
  console.log("state.oceanData.geometry.type:", state.oceanData.geometry?.type);
  console.log("state.oceanData.geometry.coordinates length:", state.oceanData.geometry?.coordinates?.length);
} else {
  console.warn("⚠ state.oceanData is unexpected type:", state.oceanData?.type);
}

// 1D: landBgData
console.log("state.landBgData exists:", !!state.landBgData);
console.log("state.landBgData type:", state.landBgData?.type);

// 1E: Canvas and projection sanity
console.log("Canvas element exists:", !!mapCanvas);
console.log("Canvas .width (device px):", mapCanvas?.width);
console.log("Canvas .height (device px):", mapCanvas?.height);
console.log("Canvas style.width:", mapCanvas?.style?.width);
console.log("Canvas style.height:", mapCanvas?.style?.height);
console.log("Context exists:", !!context);
console.log("Projection exists:", !!projection);
console.log("Projection scale():", projection?.scale());
console.log("Projection translate():", projection?.translate());
console.log("Projection center():", projection?.center());
console.log("pathCanvas exists:", !!pathCanvas);
console.log("pathSVG exists:", !!pathSVG);
console.log("state.dpr:", state.dpr);
console.log("state.width:", state.width);
console.log("state.height:", state.height);

// 1F: landData sanity
console.log("state.landData exists:", !!state.landData);
console.log("state.landData.features count:", state.landData?.features?.length);
if (state.landData?.features?.length > 0) {
  const sampleFeature = state.landData.features[0];
  console.log("Sample landData feature[0].properties:", JSON.stringify(sampleFeature?.properties));
  console.log("Sample landData feature[0].id (raw .id):", sampleFeature?.id);
  console.log("getFeatureId(feature[0]) returns:", getFeatureId(sampleFeature));
}

console.groupEnd();
```

---

### INJECTION POINT 2: Inside `drawCanvas()`, replace lines 426-431 (the ocean block)

Find this existing code (around line 426):
```javascript
if (state.oceanData) {
    context.beginPath();
    pathCanvas(state.oceanData);
    context.fillStyle = OCEAN_FILL_COLOR;
    context.fill();
  }
```

Replace it with this diagnostic-instrumented version:

```javascript
// ══════════════════════════════════════════════════════════════
// DIAGNOSTIC BLOCK 2: Ocean Rendering Audit
// ══════════════════════════════════════════════════════════════
if (state.oceanData) {
  if (!window.__diagOceanLogged) {
    console.group("🌊 DIAG-2: Ocean Rendering");
    console.log("oceanData.type:", state.oceanData.type);

    // If it's a FeatureCollection, iterate features individually
    const oceanFeatures = state.oceanData.type === "FeatureCollection"
      ? state.oceanData.features
      : [state.oceanData];

    console.log("Ocean features to draw:", oceanFeatures.length);

    // Test projection of first ocean feature bounding box
    if (pathSVG && oceanFeatures.length > 0) {
      const testBounds = pathSVG.bounds(oceanFeatures[0]);
      console.log("First ocean feature SVG bounds:", testBounds);
      const boundsWidth = testBounds[1][0] - testBounds[0][0];
      const boundsHeight = testBounds[1][1] - testBounds[0][1];
      console.log("First ocean feature projected size:", boundsWidth, "x", boundsHeight);
      if (boundsWidth > 50000 || boundsHeight > 50000) {
        console.warn("⚠ Ocean feature projects to ENORMOUS size — likely a sphere-wrapping polygon or inverted winding");
      }
      if (boundsWidth <= 0 || boundsHeight <= 0) {
        console.warn("⚠ Ocean feature projects to ZERO/NEGATIVE size — degenerate geometry");
      }
      if (!Number.isFinite(boundsWidth) || !Number.isFinite(boundsHeight)) {
        console.warn("⚠ Ocean feature bounds are NaN/Infinity — projection failure");
      }
    }

    // Test: does pathCanvas produce a path at all?
    context.beginPath();
    const pathResult = pathCanvas(oceanFeatures[0]);
    console.log("pathCanvas(oceanFeatures[0]) returned:", pathResult);
    // Check if the canvas path has any segments
    // We can't inspect the path directly, but we can check if fill produces pixels
    console.log("About to fill ocean with:", OCEAN_FILL_COLOR);
    console.groupEnd();
    window.__diagOceanLogged = true;
  }

  // Actual render — iterate features individually for reliability
  const oceanFeatures = state.oceanData.type === "FeatureCollection"
    ? state.oceanData.features
    : [state.oceanData];

  for (const oceanFeature of oceanFeatures) {
    context.beginPath();
    pathCanvas(oceanFeature);
    context.fillStyle = OCEAN_FILL_COLOR;
    context.fill();
  }
} else {
  if (!window.__diagOceanLogged) {
    console.warn("⚠ DIAG-2: state.oceanData is FALSY at draw time — ocean will not render");
    window.__diagOceanLogged = true;
  }
}
```

---

### INJECTION POINT 3: Inside `drawCanvas()`, instrument the political fill loop

Find the existing loop (around line 452):
```javascript
for (const feature of state.landData.features) {
    if (!pathBoundsInScreen(feature)) continue;
    const id = getFeatureId(feature);
    const fill = id && state.colors[id] ? state.colors[id] : "#d6d6d6";
    context.beginPath();
    pathCanvas(feature);
    context.fillStyle = fill;
    context.fill();
  }
```

Replace with:

```javascript
// ══════════════════════════════════════════════════════════════
// DIAGNOSTIC BLOCK 3: Color ID Alignment Audit
// ══════════════════════════════════════════════════════════════
if (!window.__diagColorLogged) {
  console.group("🎨 DIAG-3: Color ID Alignment");
  const colorKeys = Object.keys(state.colors);
  console.log("state.colors has", colorKeys.length, "entries");
  console.log("state.colors sample keys (first 10):", colorKeys.slice(0, 10));
  console.log("state.colors sample values (first 10):", colorKeys.slice(0, 10).map(k => state.colors[k]));

  // Check what IDs the features produce
  const featureIds = state.landData.features.slice(0, 10).map(f => ({
    "getFeatureId()": getFeatureId(f),
    "properties.id": f?.properties?.id,
    "raw .id": f?.id,
    "properties.NUTS_ID": f?.properties?.NUTS_ID,
  }));
  console.log("First 10 feature IDs (all resolution paths):");
  console.table(featureIds);

  // Critical mismatch detection
  if (colorKeys.length > 0 && state.landData.features.length > 0) {
    const firstFeatureId = getFeatureId(state.landData.features[0]);
    const hasMatch = firstFeatureId in state.colors;
    console.log("First feature ID:", JSON.stringify(firstFeatureId), "typeof:", typeof firstFeatureId);
    console.log("First color key:", JSON.stringify(colorKeys[0]), "typeof:", typeof colorKeys[0]);
    console.log("First feature ID found in state.colors?", hasMatch);

    if (!hasMatch) {
      console.error("❌ ID MISMATCH DETECTED: Feature IDs do not match state.colors keys!");
      console.log("Feature ID format sample:", firstFeatureId);
      console.log("Color key format sample:", colorKeys[0]);
    }

    // Count matches vs misses
    let hits = 0;
    let misses = 0;
    const missedIds = [];
    for (const f of state.landData.features) {
      const fid = getFeatureId(f);
      if (fid && state.colors[fid]) {
        hits++;
      } else {
        misses++;
        if (missedIds.length < 5) missedIds.push(fid);
      }
    }
    console.log(`Color lookup: ${hits} hits, ${misses} misses out of ${state.landData.features.length} features`);
    if (misses > 0) {
      console.log("Sample missed IDs:", missedIds);
    }
  }
  console.groupEnd();
  window.__diagColorLogged = true;
}

// Actual render with per-feature sampling (first frame only)
let __diagFallbackCount = 0;
let __diagColoredCount = 0;
const __diagFallbackColors = new Set();
const __diagUsedColors = new Set();

for (const feature of state.landData.features) {
  if (!pathBoundsInScreen(feature)) continue;
  const id = getFeatureId(feature);
  const fill = id && state.colors[id] ? state.colors[id] : "#d6d6d6";

  if (fill === "#d6d6d6") {
    __diagFallbackCount++;
  } else {
    __diagColoredCount++;
    __diagUsedColors.add(fill);
  }

  context.beginPath();
  pathCanvas(feature);
  context.fillStyle = fill;
  context.fill();
}

if (!window.__diagFillStatsLogged) {
  console.group("📊 DIAG-3b: Fill Statistics");
  console.log("Features rendered with assigned color:", __diagColoredCount);
  console.log("Features rendered with fallback #d6d6d6:", __diagFallbackCount);
  console.log("Unique colors used:", __diagUsedColors.size, "→", [...__diagUsedColors]);
  if (__diagFallbackCount > __diagColoredCount && __diagColoredCount > 0) {
    console.warn("⚠ Majority of features are hitting fallback color — likely ID mismatch");
  }
  if (__diagUsedColors.size === 1 && __diagColoredCount > 10) {
    console.warn("⚠ All colored features use SAME color — neighbor differentiation is broken");
  }
  console.groupEnd();
  window.__diagFillStatsLogged = true;
}
```

---

### INJECTION POINT 4: Inside `autoFillMap()`, instrument the political branch

Find the existing code (around line 688):
```javascript
if (mode === "political" && state.topology?.objects?.political) {
    const politicalMap = ColorManager.computePoliticalColors(state.topology, "political");
```

Add diagnostic logging right after `computePoliticalColors`:

```javascript
if (mode === "political" && state.topology?.objects?.political) {
    const politicalMap = ColorManager.computePoliticalColors(state.topology, "political");

    // ══════════════════════════════════════════════════════════════
    // DIAGNOSTIC BLOCK 4: Auto-Fill Political Color Audit
    // ══════════════════════════════════════════════════════════════
    console.group("🗳 DIAG-4: Auto-Fill Political Colors");
    const pmKeys = Object.keys(politicalMap);
    console.log("computePoliticalColors returned", pmKeys.length, "entries");
    console.log("Sample politicalMap keys (first 10):", pmKeys.slice(0, 10));
    console.log("Sample politicalMap values (first 10):", pmKeys.slice(0, 10).map(k => politicalMap[k]));

    // Check for undefined/null values
    const undefinedCount = pmKeys.filter(k => politicalMap[k] == null).length;
    console.log("Entries with null/undefined color:", undefinedCount);
    if (undefinedCount > 0) {
      console.error("❌ computePoliticalColors produced null/undefined colors!");
    }

    // Unique color distribution
    const uniqueColors = new Set(Object.values(politicalMap));
    console.log("Unique colors in politicalMap:", uniqueColors.size, "→", [...uniqueColors]);
    if (uniqueColors.size === 1) {
      console.error("❌ ALL features got the SAME color — neighbor graph is broken");
    }

    // Cross-reference: do politicalMap keys match landData feature IDs?
    const landFeatureIds = state.landData.features.slice(0, 10).map(f => getFeatureId(f));
    console.log("Sample landData feature IDs:", landFeatureIds);
    const matchCount = landFeatureIds.filter(id => id in politicalMap).length;
    console.log(`ID cross-reference: ${matchCount}/${landFeatureIds.length} landData IDs found in politicalMap`);
    if (matchCount === 0) {
      console.error("❌ ZERO landData IDs found in politicalMap — total ID format mismatch!");
      console.log("politicalMap uses IDs like:", pmKeys[0]);
      console.log("landData uses IDs like:", landFeatureIds[0]);
    }

    // Check neighbor graph quality
    const geometries = state.topology.objects.political.geometries;
    let neighborResult;
    try {
      neighborResult = globalThis.topojson.neighbors(geometries);
      const hasNeighbors = neighborResult.filter(n => n.length > 0).length;
      console.log(`Neighbor graph: ${hasNeighbors}/${geometries.length} geometries have ≥1 neighbor`);
      if (hasNeighbors === 0) {
        console.error("❌ Neighbor graph is EMPTY — all geometries are isolated");
      }
      // Sample neighbor counts
      console.log("Neighbor counts (first 10):", neighborResult.slice(0, 10).map(n => n.length));
    } catch (e) {
      console.error("❌ topojson.neighbors() threw:", e.message);
    }

    // Country code extraction check
    const sampleCodes = geometries.slice(0, 10).map((g, i) => ({
      id: ColorManager.getFeatureId(g, i),
      countryCode: ColorManager.getCountryCode(g, i),
      rawCntrCode: g?.properties?.cntr_code,
    }));
    console.log("Sample country code extraction:");
    console.table(sampleCodes);

    console.groupEnd();
```

(The rest of the `autoFillMap` function continues unchanged after this block.)

---

## How to Apply

1. Open [map_renderer.js](js/core/map_renderer.js)
2. **Injection 1:** Paste DIAG-1 block inside `initMap()` at line ~954, just before the closing `}`
3. **Injection 2:** Replace the ocean `if` block at lines 426-431 with the DIAG-2 block
4. **Injection 3:** Replace the political fill loop at lines 452-460 with the DIAG-3 block
5. **Injection 4:** Add DIAG-4 inside `autoFillMap()` right after `computePoliticalColors` call at line 689
6. Open the app in Chrome, open DevTools Console
7. Trigger auto-fill (political mode) from the UI
8. Copy the full console output

---

## Console Interpretation Guide

### Bug 1: Invisible Ocean — What to Look For

| Console Output | Diagnosis | Root Cause |
|---|---|---|
| `state.oceanData is FALSY` | Ocean data never loaded | `topology.objects.ocean` missing or `topojson.feature()` failed |
| `oceanData.type: FeatureCollection` with features count > 0 | Data exists — rendering issue | Path projection or canvas context problem |
| `Ocean feature projected size: 50000+ x 50000+` | **Sphere-wrapping polygon** | The ocean polygon has inverted winding order. D3 fills the "outside" (entire sphere minus the hole), producing a giant fill that covers everything or overflows the canvas |
| `Ocean feature projected size: 0 x 0` or `NaN` | Degenerate geometry or projection failure | Coordinates are empty, or projection can't handle the extent |
| `Canvas .width: 0` or `Canvas .height: 0` | Canvas never sized | `setCanvasSize()` ran before container had dimensions |
| `Projection scale(): NaN` | Projection never fitted | `fitProjection()` failed or ran with empty data |
| `pathCanvas(oceanFeatures[0]) returned: undefined` | Normal — d3 geoPath with canvas context returns undefined | This is expected; the path is drawn into the context, not returned. Focus on bounds instead |

**Most likely culprit:** The ocean polygons in the topology use GeoJSON winding order (RFC 7946: counterclockwise for exterior rings), but D3 uses the **opposite convention** (clockwise for exterior rings). This causes D3 to interpret the polygon as covering the entire sphere *minus* the intended ocean area — resulting in either an invisible fill (clipped away) or a massive artifact that covers everything.

### Bug 2: Broken Auto-Fill — What to Look For

| Console Output | Diagnosis | Root Cause |
|---|---|---|
| `computePoliticalColors returned 0 entries` | Function returned empty | `topology.objects.political.geometries` is empty or unreachable |
| `Unique colors in politicalMap: 1` | All countries same color | Neighbor graph is empty (no shared arcs) → all countries get same palette seed |
| `ZERO landData IDs found in politicalMap` | **Total ID format mismatch** | `computePoliticalColors` uses numeric `.id` (0, 1, 2...) but `getFeatureId()` returns `properties.id` ("AFG-1741") |
| `Entries with null/undefined color: > 0` | `pickPaletteColor` returned null | Empty palette or logic error |
| `Neighbor graph: 0/N geometries have ≥1 neighbor` | **Topology has no shared arcs** | The TopoJSON was built without proper arc-sharing between adjacent polygons — `topojson.neighbors()` can't find adjacency |
| `All colored features use SAME color` in DIAG-3b | Confirms the visual bug | Cross-reference with DIAG-4 to determine if it's neighbor-graph or ID-mismatch |
| `Color lookup: 0 hits, N misses` in DIAG-3 | Colors were computed but keyed differently | The `politicalMap` keys don't match what `getFeatureId()` returns for GeoJSON features |

**Most likely culprit (based on static analysis):**

Looking at the code, `ColorManager.computePoliticalColors` operates on raw **TopoJSON geometries** (`topology.objects.political.geometries`). It calls `ColorManager.getFeatureId(geometry, index)` which checks `geometry.properties.id` first. From the topology data, `properties.id = "AFG-1741"` and raw `geometry.id = 0` (numeric). Since `properties.id` exists, the function returns `"AFG-1741"`.

Meanwhile in `autoFillMap`, `getFeatureId(feature)` operates on **GeoJSON features** (converted by `topojson.feature()`). These features also have `properties.id = "AFG-1741"`. So the IDs *should* match.

**However**, if the neighbor graph is empty (no shared arcs in the topology), then `countryAdjacency` will have no edges. Every country gets `used = new Set()` (empty), so `pickPaletteColor` always picks the same seed-based color. With 8305 geometries all mapping to the same set of country codes with the same hash seeds and no neighbor constraints, most countries will indeed get the same color.

---

## Decision Tree

```
Start
 │
 ├─ DIAG-1: Is state.oceanData truthy?
 │   ├─ NO → Ocean data never loaded. Check topology file.
 │   └─ YES → DIAG-2: What are the projected bounds?
 │       ├─ Enormous (>50000px) → Winding order bug. Fix in topology builder.
 │       ├─ Zero/NaN → Projection not fitted or degenerate coords.
 │       └─ Reasonable (100-5000px) → Check canvas dimensions & z-order.
 │
 ├─ DIAG-3: Color lookup hits vs misses?
 │   ├─ All misses → ID format mismatch. Compare key formats.
 │   └─ All hits but same color → DIAG-4: Check neighbor graph.
 │       ├─ Neighbor graph empty → Topology lacks shared arcs.
 │       └─ Neighbor graph populated → Check pickPaletteColor logic.
 │
 └─ DIAG-4: Unique colors in politicalMap?
     ├─ 1 color → Neighbor constraints aren't working.
     ├─ 2-6 colors → Working correctly (palette has 6 colors).
     └─ 0 colors → computePoliticalColors returned empty map.
```

---

## After Running Diagnostics

Paste the full console output back. The three most actionable outcomes are:

1. **Ocean winding order** — fixable in `map_builder/geo/topology.py` by reversing ring orientation for ocean polygons, or in the renderer by using `d3.geoPath` with `{winding: "counterclockwise"}` (D3 v7+).

2. **Empty neighbor graph** — fixable in the topology build step by ensuring `topojson.topology()` receives polygons with shared boundaries (not pre-simplified individual polygons). The `topojson.neighbors()` function requires arcs to be shared between geometries.

3. **ID mismatch** — fixable by aligning the key used in `computePoliticalColors` result with what `getFeatureId()` returns for GeoJSON features.
