# QA-018: Auto-Fill Countries Color Fix

**Date:** 2026-02-08
**Files Modified:** `js/core/map_renderer.js`, `js/core/color_manager.js`
**Bug:** "Auto-Fill Countries" renders monochromatic gray instead of distinct country colors

---

## Root Cause Analysis

Three compounding issues were identified:

### 1. Empty Neighbor Graph (Primary Cause)

`ColorManager.computePoliticalColors()` calls `topojson.neighbors(geometries)` to build a country adjacency graph. This function finds adjacency by detecting **shared arcs** between geometries in the topology.

**Problem:** If the topology was built from individually processed polygons (e.g., each admin-2 subdivision simplified independently before merging), the resulting TopoJSON may have **no shared arcs** between neighboring geometries. When `topojson.neighbors()` returns all-empty arrays, the graph-coloring algorithm has zero constraints — every country picks the same hash-seeded color from a 6-color palette, producing a near-monochromatic result.

**Data verification (8305 geometries):**
- All features have `properties.id` (e.g., "AFG-1741", "DE211", "FR_ARR_57003")
- All features have `properties.cntr_code` (e.g., "AF", "DE", "FR")
- 91 unique country codes across the dataset
- The top-level geometry `id` field is a numeric index (0, 1, 2, ...), separate from `properties.id`

**Previous behavior:** When the neighbor graph was empty, the code still ran the same graph-coloring loop but with all `used` sets being empty. Every country's color was determined purely by `stableHash(countryCode) % 6`. Countries with hash values landing on the same palette index got identical colors.

**Fix:** Added explicit detection of empty neighbor graphs. When `neighborGraphPopulated === false`, the code falls back to a hash-distributed coloring that uses `(stableHash(code) + orderIndex) % paletteSize`, guaranteeing at least some distribution across the palette.

### 2. ID Fallback Mismatch Between Writer and Reader

`autoFillMap()` assigns colors using: `getFeatureId(feature) || 'feature-${index}'`
`drawCanvas()` looked up colors using: `getFeatureId(feature)` (returning `null` with no fallback)

If any feature's `getFeatureId()` returned `null` (e.g., a feature with only a numeric `.id = 0` which is falsy), the color was stored under key `"feature-0"` but looked up under key `null`, resulting in the gray fallback.

**Fix:** `drawCanvas()` now uses the same fallback pattern: `getFeatureId(feature) || 'feature-${index}'`

### 3. No Integration with User Country Palette

`state.countryPalette` in `state.js` contains 43 manually-curated country colors (e.g., `DE: "#5d7cba"`, `FR: "#4a90e2"`). The old `autoFillMap` ignored this palette entirely, relying solely on the 6-color `strictPoliticalPalette`.

**Fix:** The priority chain now includes `state.countryPalette` as a fallback:
```
featureColors[id] → countryColors[countryCode] → state.countryPalette[countryCode] → hashFallback
```

---

## Changes Made

### `js/core/color_manager.js` — `computePoliticalColors()`

**Before:** Returned a flat `result` object: `{ "AFG-1741": "#color", ... }`
**After:** Returns `{ featureColors, countryColors }` where:
- `featureColors`: same per-feature-ID mapping
- `countryColors`: per-country-code mapping (e.g., `{ "AF": "#1f77b4", "DE": "#d62728" }`)

Added `neighborGraphPopulated` flag. When the neighbor graph is empty, uses a deterministic hash+index distribution instead of the graph-coloring algorithm.

### `js/core/map_renderer.js` — `autoFillMap()`

**Before:** Called `computePoliticalColors()` and got a flat map, then tried to build `colorByCountry` from topology geometries in a second loop. The mapping chain was fragile.

**After:** Destructures `{ featureColors, countryColors }` directly. Single broadcast loop over `state.landData.features` with a clear priority chain:
1. Direct feature-ID match from `featureColors`
2. Country-code match from `countryColors`
3. User palette from `state.countryPalette`
4. Hash-based deterministic fallback

Added console logging showing feature count, country count, and unique color count.

### `js/core/map_renderer.js` — `drawCanvas()`

**Before:** `const id = getFeatureId(feature);` (returns `null` for features without string ID)
**After:** `const id = getFeatureId(feature) || 'feature-${index}';` (matches autoFillMap's fallback)

Changed `for...of` loop to `.forEach()` to have access to the `index` parameter.

---

## CSP eval() Warning

The browser console shows: `Content Security Policy blocks the use of 'eval' in JavaScript`

**Source:** This comes from the CDN-loaded `d3.v7.min.js` bundle, which internally uses `new Function()` in its `d3-format` and `d3-time-format` submodules for generating optimized parser functions.

**Impact on auto-fill:** None. The eval-blocked code paths are for number/date formatting, not geospatial computation. `topojson.neighbors()`, `topojson.feature()`, and `d3.geoPath()` do not use eval.

**Impact on other features:** The `d3.format()` and `d3.timeFormat()` functions may silently fail or produce fallback behavior. This is unlikely to affect the map creator since it doesn't use explicit number/time formatting.

**Possible fixes (if needed):**
1. Add `<meta http-equiv="Content-Security-Policy" content="script-src 'self' https://d3js.org https://unpkg.com 'unsafe-eval';">` to `index.html` (reduces security)
2. Self-host d3 and topojson and use tree-shaken builds that exclude `d3-format`/`d3-time-format`
3. If using VS Code Live Server, the CSP may be server-injected — switching to a simple `python -m http.server` or `npx serve` would bypass it

---

## Verification Steps

After applying these changes, clicking "Auto-Fill Countries" should:
1. Console: `[autoFillMap] Political: 8305 features colored, 91 countries resolved, N unique colors` (N should be 2-6)
2. Console: Either "Neighbor graph empty — using hash-distributed coloring" (if topology lacks shared arcs) or no warning (if arcs are shared)
3. Visual: Map shows distinct colors for neighboring countries — at least 4-5 different colors visible across the map

If the map still shows monochromatic output AND the console shows `91 countries resolved, 1 unique colors`:
- The `strictPoliticalPalette` (6 colors) combined with hash distribution may still produce collisions
- Solution: expand the palette or use `state.countryPalette` (43 colors) as the primary source

---

## Topology Quality Note

For optimal graph-coloring (4-color theorem), the topology needs **shared arcs** between adjacent countries. This requires the `map_builder` Python pipeline to:
1. Union all input polygons into a single topology (not process them individually)
2. Use `topojson.Topology()` which automatically deduplicates shared boundaries into arcs
3. Verify with: `topojson.neighbors(topology.objects.political.geometries).filter(n => n.length > 0).length` — should be close to the total geometry count, not 0
