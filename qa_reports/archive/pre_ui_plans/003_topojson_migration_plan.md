# Phase 2: TopoJSON Migration Plan

**Document Version:** 1.0
**Phase:** Architecture Migration
**Objective:** Migrate from GeoJSON to TopoJSON for 60fps rendering and dynamic borders

---

## Executive Summary

The current GeoJSON-based architecture has inherent performance limitations:
- **Redundant Geometry:** Shared borders between regions are stored twice (once per adjacent polygon)
- **Large File Sizes:** Multiple separate GeoJSON files (~10+ MB combined)
- **Static Borders:** Pre-computed border lines cannot adapt to user-applied colors
- **No Arc Sharing:** Each feature's coordinates are independent, preventing topology-aware operations

TopoJSON addresses all of these by:
- Encoding shared boundaries as **arcs** (stored once, referenced by index)
- Enabling **quantization** to reduce coordinate precision and file size
- Providing `topojson.mesh()` for **dynamic border rendering** based on runtime conditions
- Combining multiple layers into a single file with shared arc pool

**Expected Improvements:**
| Metric | Current (GeoJSON) | Target (TopoJSON) |
|--------|-------------------|-------------------|
| Total file size | ~8-12 MB | ~1-2 MB |
| Initial load time | 2-4 seconds | < 500ms |
| Arc redundancy | ~100% duplication | 0% (shared) |
| Border rendering | Static | Dynamic (color-aware) |
| Zoom performance | Acceptable | 60fps target |

---

## Section 1: Python Data Pipeline Strategy

### 1.1 New Dependency

**Library:** `topojson` by Mattijn (PyPI: `topojson`)

```bash
pip install topojson
```

**Why this library?**
- Pure Python, integrates directly with GeoPandas
- Supports multiple GeoDataFrames → single TopoJSON object
- Handles quantization, arc sharing, and delta encoding
- Actively maintained with good documentation

**Update `ensure_packages()` in `init_map_data.py`:**
```python
ensure_packages(["geopandas", "matplotlib", "mapclassify", "requests", "shapely", "topojson"])
```

### 1.2 Topology Construction Strategy

**Current Separate Outputs:**
```
data/
├── europe_final_optimized.geojson   (political regions - interactive)
├── europe_ocean.geojson             (background)
├── europe_land_bg.geojson           (background)
├── europe_urban.geojson             (overlay)
├── europe_physical.geojson          (overlay)
├── europe_rivers.geojson            (lines)
└── europe_countries_combined.geojson (border lines - DEPRECATED)
```

**Target Single Output:**
```
data/
├── europe_topology.json             (ALL layers, shared arcs)
└── preview.png                      (unchanged)
```

**Topology Object Structure:**
```json
{
  "type": "Topology",
  "arcs": [...],
  "objects": {
    "political": { ... },   // Interactive regions (NUTS-3 + Admin-1 hybrid)
    "ocean": { ... },       // Background fill
    "land": { ... },        // Land background
    "urban": { ... },       // Urban overlay
    "physical": { ... },    // Physical regions overlay
    "rivers": { ... }       // River lines
  }
}
```

**Critical:** The `political` object MUST include all features that participate in dynamic border detection. Borders are computed at runtime, NOT stored.

### 1.3 Build Order (Arc Sharing Logic)

TopoJSON arc sharing only works for geometries that **share exact coordinate sequences**. To maximize arc reuse:

1. **Process all layers to WGS84 (EPSG:4326)** with consistent coordinate precision
2. **Round all geometries to 4 decimal places** (existing `round_geometries()` function)
3. **Apply Smart Island Culling and Balkan Fallback BEFORE topology generation**
4. **Merge layers into topology in a single call**

**Important:** Do NOT simplify after topology generation. Simplification must happen BEFORE merging, as the `topojson` library's internal simplification may break geometry validity.

### 1.4 Quantization Parameter

**Definition:** Quantization reduces floating-point coordinates to integers within a grid, dramatically reducing file size.

**Formula:** `q = 10^n` where `n` is the number of significant digits.

| Quantization | Grid Size | Precision (~m at equator) | File Size Reduction |
|--------------|-----------|---------------------------|---------------------|
| 1e4 | 10,000 | ~1,100m | Very aggressive |
| 1e5 | 100,000 | ~110m | Recommended |
| 1e6 | 1,000,000 | ~11m | Conservative |

**Recommendation:** Use `1e5` (100,000) for balance between detail and file size.

At European latitudes (~50°N), this translates to approximately **70-100 meters** precision, which is invisible at our zoom range (1x-8x).

### 1.5 Implementation: New `build_topology()` Function

**File:** `init_map_data.py`

**Location:** Add after `save_outputs()` function, call from `main()`

```python
import topojson as tp

def build_topology(
    political: gpd.GeoDataFrame,
    ocean: gpd.GeoDataFrame,
    land: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    physical: gpd.GeoDataFrame,
    rivers: gpd.GeoDataFrame,
    output_path: Path,
    quantization: int = 100_000,
) -> None:
    """
    Convert multiple GeoDataFrames into a single TopoJSON topology.

    Arc sharing is maximized by processing all layers in a single call.
    """
    print("Building TopoJSON topology...")

    # Ensure all layers are in WGS84
    layers = {
        "political": political.to_crs("EPSG:4326") if political.crs != "EPSG:4326" else political,
        "ocean": ocean.to_crs("EPSG:4326") if ocean.crs != "EPSG:4326" else ocean,
        "land": land.to_crs("EPSG:4326") if land.crs != "EPSG:4326" else land,
        "urban": urban.to_crs("EPSG:4326") if urban.crs != "EPSG:4326" else urban,
        "physical": physical.to_crs("EPSG:4326") if physical.crs != "EPSG:4326" else physical,
        "rivers": rivers.to_crs("EPSG:4326") if rivers.crs != "EPSG:4326" else rivers,
    }

    # Build topology with shared arcs
    topo = tp.Topology(
        data=layers,
        prequantize=quantization,
        presimplify=False,  # Already simplified in GeoDataFrame processing
        toposimplify=False,
        shared_coords=True,
    )

    # Export to JSON
    topo_dict = topo.to_dict()

    # Verify critical properties survived
    political_obj = topo_dict.get("objects", {}).get("political", {})
    geometries = political_obj.get("geometries", [])
    if geometries:
        sample = geometries[0].get("properties", {})
        required = ["id", "cntr_code"]
        missing = [key for key in required if key not in sample]
        if missing:
            print(f"WARNING: TopoJSON missing properties: {missing}")

    # Write to file
    import json
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(topo_dict, f, separators=(",", ":"))  # Compact JSON

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"TopoJSON saved to {output_path} ({file_size_mb:.2f} MB)")
    print(f"  - Objects: {list(topo_dict.get('objects', {}).keys())}")
    print(f"  - Total arcs: {len(topo_dict.get('arcs', []))}")
```

### 1.6 Update `main()` Function

**Add at end of `main()`, after existing `save_outputs()` call:**

```python
# Build TopoJSON output
topology_path = output_dir / "europe_topology.json"
build_topology(
    political=final_hybrid,
    ocean=ocean_clipped,
    land=land_bg_clipped,
    urban=urban_clipped,
    physical=physical_filtered,
    rivers=rivers_clipped,
    output_path=topology_path,
    quantization=100_000,
)
```

### 1.7 Validation Checklist (Python)

After running `init_map_data.py`:

- [ ] `data/europe_topology.json` exists and is < 3 MB
- [ ] Contains 6 objects: `political`, `ocean`, `land`, `urban`, `physical`, `rivers`
- [ ] `political` geometries have `id` and `cntr_code` properties
- [ ] Arc count is significantly less than sum of all feature coordinates (arc sharing working)
- [ ] No "WARNING" messages about missing properties

---

## Section 2: Frontend Rendering Strategy

### 2.1 New Dependency

**Library:** `topojson-client` (via CDN)

**Update `index.html`:**
```html
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://unpkg.com/topojson-client@3"></script>
<script src="js/app.js"></script>
```

This provides:
- `topojson.feature(topology, object)` - Convert object to GeoJSON FeatureCollection
- `topojson.mesh(topology, object, filter)` - Extract shared boundaries as MultiLineString
- `topojson.neighbors(objects)` - Find adjacent features (useful for future)

### 2.2 Data Loading Changes

**Current Pattern (GeoJSON):**
```javascript
async function loadData() {
  const [land, rivers, borders, ocean, landBg, urban, physical] = await Promise.all([
    d3.json("data/europe_final_optimized.geojson"),
    d3.json("data/europe_rivers.geojson"),
    d3.json("data/europe_countries_combined.geojson"),
    // ... 7 separate fetches
  ]);
  landData = land;
  riversData = rivers;
  // ... manual assignment
}
```

**New Pattern (TopoJSON):**
```javascript
let topology = null;  // Raw TopoJSON (kept for mesh operations)

async function loadData() {
  try {
    topology = await d3.json("data/europe_topology.json");

    // Unpack each object to GeoJSON for fill rendering
    landData = topojson.feature(topology, topology.objects.political);
    riversData = topojson.feature(topology, topology.objects.rivers);
    oceanData = topojson.feature(topology, topology.objects.ocean);
    landBgData = topojson.feature(topology, topology.objects.land);
    urbanData = topojson.feature(topology, topology.objects.urban);
    physicalData = topojson.feature(topology, topology.objects.physical);

    // bordersData is NO LONGER pre-loaded - computed dynamically!
    bordersData = null;

    buildIndex();
    fitProjection();
    renderFull();
  } catch (error) {
    console.error("Failed to load TopoJSON:", error);
  }
}
```

### 2.3 Dynamic Border Rendering (The Core Feature)

**The Problem with Static Borders:**
Currently, `bordersData` contains pre-computed country boundary lines. These are drawn regardless of what colors the user has applied. This creates visual noise when two adjacent regions have the same color.

**The Solution: `topojson.mesh()` with Filter:**

```javascript
function getDynamicBorders() {
  if (!topology || !topology.objects.political) return null;

  // Generate borders only where adjacent regions have DIFFERENT colors
  return topojson.mesh(
    topology,
    topology.objects.political,
    (a, b) => {
      // a and b are adjacent geometries
      // Return TRUE to include this arc in the mesh (draw border)
      // Return FALSE to exclude it (no border between same-colored regions)

      const idA = a.properties?.id || a.properties?.NUTS_ID;
      const idB = b.properties?.id || b.properties?.NUTS_ID;

      const colorA = colors[idA] || null;
      const colorB = colors[idB] || null;

      // Draw border if colors differ OR if either region is uncolored
      // This ensures unpainted regions still show administrative borders
      return colorA !== colorB;
    }
  );
}
```

**Coastline Handling:**
The filter function receives `(a, b)` where:
- `a` is always a geometry (the current feature)
- `b` is either an adjacent geometry OR `undefined` (for exterior boundaries like coastlines)

To **exclude coastlines** (exterior boundaries):
```javascript
(a, b) => {
  if (!b) return false;  // Exterior boundary (coastline) - don't draw
  // ... rest of color comparison
}
```

To **include coastlines** as static lines:
```javascript
(a, b) => {
  if (!b) return true;  // Always draw coastlines
  // ... rest of color comparison
}
```

**Recommendation:** For this map, we want coastlines drawn as static lines, but internal borders only where colors differ.

### 2.4 Updated `renderFull()` Function

**Key Changes:**
1. Remove static `bordersData` rendering
2. Add dynamic border computation before drawing
3. Compute borders AFTER drawing filled regions (so we know current `colors` state)

```javascript
function renderFull() {
  if (!landData || !topology) return;
  const k = zoomTransform.k;

  // ... existing colorCtx setup and background rendering ...

  // ... existing region fill loops (unchanged) ...

  // ... existing lineCtx setup ...

  // ... existing physical/urban overlay rendering (unchanged) ...

  // === DYNAMIC BORDERS (NEW) ===
  const dynamicBorders = getDynamicBorders();
  if (dynamicBorders) {
    lineCtx.beginPath();
    linePath(dynamicBorders);
    lineCtx.strokeStyle = "#111111";
    lineCtx.lineWidth = 0.8 / k;
    lineCtx.stroke();
  }

  // === STATIC COASTLINES (NEW) ===
  const coastlines = getCoastlines();
  if (coastlines) {
    lineCtx.beginPath();
    linePath(coastlines);
    lineCtx.strokeStyle = "#333333";
    lineCtx.lineWidth = 1.2 / k;
    lineCtx.stroke();
  }

  // Rivers (unchanged)
  if (showRivers && riversData) {
    lineCtx.beginPath();
    linePath(riversData);
    lineCtx.strokeStyle = "#3498db";
    lineCtx.lineWidth = 1 / k;
    lineCtx.stroke();
  }

  // Regional outlines for unpainted areas (unchanged but optional)
  // ...

  drawHover();
  markHitDirty();
}

function getCoastlines() {
  if (!topology || !topology.objects.political) return null;

  // Coastlines are exterior arcs (where b is undefined)
  return topojson.mesh(
    topology,
    topology.objects.political,
    (a, b) => !b  // Only exterior boundaries
  );
}
```

### 2.5 Hit Detection (Unchanged)

Good news: Hit detection does NOT need to change.

The `landData` variable, after unpacking via `topojson.feature()`, is a standard GeoJSON FeatureCollection. The existing color-coded hidden canvas approach works identically.

**Verification:**
```javascript
buildIndex(); // Works the same - iterates landData.features
getFeatureIdFromEvent(event); // Works the same - uses hitCanvas
```

### 2.6 Performance Optimization: Border Caching

Computing `topojson.mesh()` on every render is expensive. Add caching:

```javascript
let cachedBorders = null;
let cachedColorsHash = null;

function getColorsHash() {
  // Simple hash of color state
  const entries = Object.entries(colors).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function getDynamicBorders() {
  if (!topology || !topology.objects.political) return null;

  const currentHash = getColorsHash();
  if (cachedBorders && cachedColorsHash === currentHash) {
    return cachedBorders;
  }

  cachedBorders = topojson.mesh(
    topology,
    topology.objects.political,
    (a, b) => {
      if (!b) return false;  // Exclude coastlines (handled separately)
      const idA = a.properties?.id;
      const idB = b.properties?.id;
      return colors[idA] !== colors[idB];
    }
  );
  cachedColorsHash = currentHash;

  return cachedBorders;
}

// Invalidate cache when colors change
function invalidateBorderCache() {
  cachedBorders = null;
  cachedColorsHash = null;
}
```

**Call `invalidateBorderCache()` in:**
- `handleClick()` after modifying `colors`
- `applyPaletteToMap()` after bulk color assignment
- `presetClear` click handler

---

## Section 3: Risk Assessment & Mitigation

### 3.1 ID Persistence Through Topology Conversion

**Risk:** The `topojson` Python library may strip or rename properties during conversion.

**Mitigation:**
1. Explicitly include properties in the output (the library preserves them by default)
2. Add validation in `build_topology()` that checks for `id` and `cntr_code`
3. Add frontend validation in `loadData()`:

```javascript
async function loadData() {
  topology = await d3.json("data/europe_topology.json");
  landData = topojson.feature(topology, topology.objects.political);

  // Validate properties survived
  const sample = landData.features[0]?.properties;
  if (!sample?.id) {
    console.error("CRITICAL: 'id' property missing from TopoJSON!");
  }
  if (!sample?.cntr_code && !sample?.CNTR_CODE) {
    console.warn("WARNING: 'cntr_code' property may be missing");
  }
  // ...
}
```

### 3.2 Coastline Drawing (Exterior vs Interior Boundaries)

**Risk:** Dynamic borders might accidentally include or exclude coastlines incorrectly.

**Explanation:**
- In `topojson.mesh(topo, object, filter)`, the filter receives `(a, b)` pairs
- `a` is always a feature
- `b` is the adjacent feature OR `undefined` for exterior boundaries (coastlines)

**Solution (Already Addressed in 2.4):**
- Use separate mesh calls: one for coastlines (`b === undefined`), one for internal borders (`b !== undefined && colorsDiffer`)
- Style them differently (coastlines thicker/darker)

### 3.3 Quantization Artifacts at High Zoom

**Risk:** At 8x zoom, quantization to 1e5 may show visible "stairstepping" on curved boundaries.

**Mitigation Options:**
1. Increase quantization to 1e6 (larger file, smoother curves)
2. Accept the artifact (most users won't zoom to 8x on specific curves)
3. Implement LOD (Level of Detail) with multiple TopoJSON files (overkill for this app)

**Recommendation:** Start with 1e5. If artifacts are visible in testing, bump to 2e5 or 1e6.

### 3.4 Browser Compatibility

**Risk:** `topojson-client` requires ES6.

**Mitigation:** Already using D3 v7 which requires ES6. No additional compatibility concerns.

### 3.5 Memory Usage

**Risk:** Keeping both `topology` (raw) and `landData` (unpacked GeoJSON) in memory.

**Analysis:**
- `topology` is needed for `mesh()` operations
- `landData` is needed for fill rendering and hit detection
- Unpacking creates new objects but JavaScript's reference semantics mean arc data isn't duplicated

**Mitigation:** Acceptable tradeoff. The combined memory is still less than loading 7 separate GeoJSON files.

### 3.6 Smart Island Culling Compatibility

**Risk:** The `smart_island_cull()` function operates on GeoDataFrames. Does topology conversion preserve the culling?

**Analysis:** Yes. The culling happens BEFORE `build_topology()` is called. The input `final_hybrid` GeoDataFrame has already been culled.

**Verification:** Ensure `build_topology()` is called with `final_hybrid`, not `hybrid`.

### 3.7 Balkan Fallback Compatibility

**Risk:** BA and XK features from `build_balkan_fallback()` may not share arcs properly with neighboring countries.

**Analysis:** This is expected. BA and XK come from Admin-0 (country-level) boundaries, while neighbors are NUTS-3 or Admin-1. The boundaries won't perfectly align.

**Mitigation:**
1. The current approach (Admin-0 fallback) is already a compromise
2. TopoJSON will still encode them; they just won't share arcs with neighbors
3. Dynamic borders will still work (colors are compared, not arc sharing)

**Long-term:** Consider sourcing BA/XK boundaries from a dataset with matching resolution.

---

## Section 4: Migration Checklist

### 4.1 Python Changes

- [ ] Add `topojson` to `ensure_packages()` call
- [ ] Add `import topojson as tp` after other imports
- [ ] Implement `build_topology()` function as specified
- [ ] Update `main()` to call `build_topology()` after `save_outputs()`
- [ ] Run script and verify `europe_topology.json` output
- [ ] Verify file size < 3 MB
- [ ] Verify all 6 objects present in output

### 4.2 Frontend Changes

- [ ] Add `topojson-client` script tag to `index.html`
- [ ] Add `let topology = null` global variable
- [ ] Update `loadData()` to fetch single TopoJSON file
- [ ] Update `loadData()` to unpack objects via `topojson.feature()`
- [ ] Implement `getDynamicBorders()` function
- [ ] Implement `getCoastlines()` function
- [ ] Implement border caching (`cachedBorders`, `invalidateBorderCache()`)
- [ ] Update `renderFull()` to use dynamic borders
- [ ] Add cache invalidation calls in `handleClick()`, `applyPaletteToMap()`, etc.
- [ ] Remove old `bordersData` references

### 4.3 Testing

- [ ] Load map - all regions visible
- [ ] Click region - color applied, border updates
- [ ] Apply "Auto-Fill Countries" - borders update to hide same-color boundaries
- [ ] Clear map - borders return to showing all administrative divisions
- [ ] Zoom to 8x - check for quantization artifacts
- [ ] Verify hit detection still works at all zoom levels
- [ ] Check console for property validation warnings

---

## Section 5: File Size Budget

**Current GeoJSON Total:** ~8-12 MB (estimated)
```
europe_final_optimized.geojson  ~4 MB
europe_rivers.geojson           ~1 MB
europe_countries_combined.geojson ~500 KB
europe_ocean.geojson            ~500 KB
europe_land_bg.geojson          ~1 MB
europe_urban.geojson            ~500 KB
europe_physical.geojson         ~1 MB
```

**Target TopoJSON:** < 2 MB

**Breakdown Estimate:**
- Arc pool (shared): ~1.2 MB
- Object references: ~200 KB
- Properties: ~100 KB
- Overhead: ~100 KB

**If file exceeds 2 MB:**
1. Increase quantization (1e5 → 5e4)
2. Simplify physical regions more aggressively (SIMPLIFY_PHYSICAL = 0.03)
3. Consider dropping physical layer from topology (load separately)

---

## Appendix A: Quick Reference - TopoJSON API

```javascript
// Convert TopoJSON object to GeoJSON FeatureCollection
const geojson = topojson.feature(topology, topology.objects.objectName);

// Extract shared boundaries as MultiLineString
const allBorders = topojson.mesh(topology, topology.objects.objectName);

// Extract filtered boundaries
const filteredBorders = topojson.mesh(
  topology,
  topology.objects.objectName,
  (a, b) => filterFunction(a, b)
);

// Get array of neighbor indices for each geometry
const neighbors = topojson.neighbors(topology.objects.objectName.geometries);
```

## Appendix B: Debugging TopoJSON Output

**Python - Inspect topology structure:**
```python
import json
with open("data/europe_topology.json") as f:
    topo = json.load(f)

print("Objects:", list(topo["objects"].keys()))
print("Total arcs:", len(topo["arcs"]))

for name, obj in topo["objects"].items():
    geoms = obj.get("geometries", [])
    print(f"  {name}: {len(geoms)} geometries")
    if geoms:
        print(f"    Sample properties: {geoms[0].get('properties', {})}")
```

**JavaScript - Inspect in browser:**
```javascript
// After loadData()
console.log("Topology objects:", Object.keys(topology.objects));
console.log("Total arcs:", topology.arcs.length);
console.log("Political features:", landData.features.length);
console.log("Sample properties:", landData.features[0].properties);
```

---

*End of Migration Plan*
