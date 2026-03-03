# QA Audit Report: Map Creator v1.0 Expansion Failure

**Audit Date:** 2026-01-25
**Auditor:** Lead Software Architect & QA Specialist
**Status:** CRITICAL - Multiple Regression Bugs Identified

---

## Executive Summary

The expansion from Western Europe to Full Europe/Russia introduced three critical regressions:
1. **Global Bloat** - Non-European landmasses visible (North America, Greenland)
2. **Topology Shattering** - German NUTS-3 regions fragmented beyond recognition
3. **Interaction Lag** - Auto-Fill fails, hover detection unresponsive

Root causes traced to: improper bounding box clipping, uniform over-simplification, missing country codes, and unoptimized render loops.

---

## Section 1: Issue Diagnosis

### BUG-01: Global Bloat (North America/Greenland Visible)

| Field | Value |
|-------|-------|
| **Issue ID** | BUG-01 |
| **Severity** | HIGH |
| **Description** | Map displays landmasses outside Europe including North America, Greenland, and potentially parts of Asia beyond the Urals. |
| **Root Cause** | The `clip_to_europe_bounds()` function uses GeoPandas `.cx[]` spatial indexer which **FILTERS by intersection** but does **NOT CLIP geometries**. Features that merely touch the bounding box are included in their entirety. |
| **File Location** | [init_map_data.py:173-184](init_map_data.py#L173-L184) |
| **Evidence** | Line 177: `clipped = gdf.cx[minx:maxx, miny:maxy]` - This is a selector, not a clipper |
| **Secondary Cause** | `EUROPE_BOUNDS = (-32.0, 30.0, 75.0, 75.0)` at line 66 lacks a Western longitude constraint that would exclude the Americas. The -32.0° minx is too permissive for Natural Earth global datasets. |

**Code Extract (Faulty):**
```python
def clip_to_europe_bounds(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    # ...
    clipped = gdf.cx[minx:maxx, miny:maxy]  # BUG: .cx[] selects, does NOT clip!
```

---

### BUG-02: Topology Shattering (German Regions Fragmented)

| Field | Value |
|-------|-------|
| **Issue ID** | BUG-02 |
| **Severity** | CRITICAL |
| **Description** | High-detail regions (Germany, Benelux, Switzerland) are fragmented into visual shards. Small polygons become unrecognizable geometric debris. |
| **Root Cause** | **Uniform simplification tolerance of 0.05** applied to ALL datasets regardless of feature density. In WGS84, 0.05° ≈ 5.5 km at European latitudes. German NUTS-3 regions (Kreise) average 30-50 km wide, meaning simplification removes 10-20% of their vertices, destroying topology. |
| **File Location** | [init_map_data.py:419](init_map_data.py#L419), [init_map_data.py:334](init_map_data.py#L334), [init_map_data.py:188](init_map_data.py#L188) |
| **Evidence** | All simplify calls use hardcoded `tolerance=0.05` |

**Affected Lines:**
| Line | Context | Problem |
|------|---------|---------|
| 188 | `despeckle_hybrid()` default parameter | 0.05 applied to hybrid layer |
| 220-222 | Dissolve simplification | 0.05 after dissolve |
| 334 | Admin-1 extension layer | 0.05 for Russia/Ukraine oblasts (acceptable) |
| 419 | NUTS-3 filtered layer | **0.05 for Germany/Poland counties (UNACCEPTABLE)** |
| 436-438 | Urban areas | 0.05 (excessive for cities) |
| 452-453 | Physical regions | 0.05 (acceptable for mountain ranges) |
| 483-484 | Borders combined | 0.05 (causes jagged national borders) |

**Appropriate Tolerances (Reference):**
| Feature Type | Recommended Tolerance | Current | Status |
|--------------|----------------------|---------|--------|
| NUTS-3 (high detail) | 0.001 - 0.005 | 0.05 | ❌ 10-50x too high |
| Admin-1 (Russia) | 0.02 - 0.05 | 0.05 | ✅ Acceptable |
| National Borders | 0.005 - 0.01 | 0.05 | ❌ 5-10x too high |
| Physical Regions | 0.02 - 0.05 | 0.05 | ✅ Acceptable |
| Urban Areas | 0.01 - 0.02 | 0.05 | ⚠️ 2-5x too high |
| Rivers | 0.005 - 0.01 | None | ✅ OK |

---

### BUG-03: Auto-Fill Feature Failure

| Field | Value |
|-------|-------|
| **Issue ID** | BUG-03 |
| **Severity** | MEDIUM |
| **Description** | "Auto-Fill Countries" button fails to color many regions. Large areas remain unpainted. |
| **Root Cause** | **Dual failure:** (1) Missing/empty `cntr_code` properties in GeoJSON features, (2) `countryPalette` lacks entries for many European countries. |
| **File Location** | [js/app.js:515-529](js/app.js#L515-L529) (Frontend), [init_map_data.py:475-480](init_map_data.py#L475-L480) (Backend) |

**Frontend Issue (app.js:521):**
```javascript
const cntr = feature.properties?.cntr_code || feature.properties?.CNTR_CODE;
if (!id || !cntr) continue;  // Silently skips regions with missing cntr_code!
```

**Backend Issue (init_map_data.py:475-480):**
```python
final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("")
missing_mask = final_hybrid["cntr_code"].str.len() == 0
if missing_mask.any() and "id" in final_hybrid.columns:
    final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[
        missing_mask, "id"
    ].astype(str).str[:2]  # Assumes ID format "XX..." but Admin-1 IDs differ
```

The Admin-1 ID format from line 318-320 is:
```python
admin1["adm1_code"] = (
    admin1.get("name", "adm1").astype(str) + "_" + admin1[iso_col].astype(str)
)  # Results in IDs like "Moscow_RU" → [:2] = "Mo" ❌
```

**Missing Country Palette Entries (app.js:44-58):**
Current palette only includes: `DE, FR, IT, PL, NL, BE, LU, AT, CH, UA, BY, MD, RU`

Missing countries in NUTS data: `ES, PT, CZ, SK, HU, RO, BG, HR, SI, EE, LV, LT, FI, SE, NO, DK, IE, UK, GR, CY, MT, TR` (partial list)

---

### BUG-04: Hover/Interaction Lag

| Field | Value |
|-------|-------|
| **Issue ID** | BUG-04 |
| **Severity** | MEDIUM |
| **Description** | Mouse hover detection is sticky/laggy. Highlighted region doesn't update smoothly. |
| **Root Cause** | **Multiple performance issues:** (1) `getImageData()` called on every mousemove, (2) Full hit-canvas redrawn every render cycle, (3) `renderFull()` called during zoom events causing frame drops. |
| **File Location** | [js/app.js:267-285](js/app.js#L267-L285), [js/app.js:305-317](js/app.js#L305-L317), [js/app.js:583-591](js/app.js#L583-L591) |

**Issue 1: Expensive Hit Detection (line 313)**
```javascript
const pixel = hitCtx.getImageData(x, y, 1, 1).data;  // GPU→CPU transfer on EVERY mousemove
```

**Issue 2: Full Redraw on Zoom (line 585)**
```javascript
.on("zoom", (event) => {
    zoomTransform = event.transform;
    renderFull();  // Called 60x/second during pan/zoom!
})
```

**Issue 3: Hit Canvas Rebuilt Every Frame (line 267-285)**
```javascript
function drawHidden() {
    // ...
    for (const feature of landData.features) {  // Iterates ALL features every frame
        // ...
    }
}
```

---

## Section 2: The Repair Specification (For Codex)

### REPAIR-01: Fix Bounding Box Clipping

**Objective:** Ensure all GeoJSON outputs contain ONLY European geometry, with no Western Hemisphere polygons.

**Step 1: Replace `.cx[]` with `gpd.clip()` in `clip_to_europe_bounds()`**

File: `init_map_data.py`, Lines 173-184

```python
# BEFORE (Faulty):
def clip_to_europe_bounds(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    try:
        gdf = gdf.to_crs("EPSG:4326")
        minx, miny, maxx, maxy = EUROPE_BOUNDS
        clipped = gdf.cx[minx:maxx, miny:maxy]  # ❌ Does NOT clip geometry
        # ...

# AFTER (Fixed):
def clip_to_europe_bounds(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    try:
        gdf = gdf.to_crs("EPSG:4326")
        minx, miny, maxx, maxy = EUROPE_BOUNDS
        bbox_geom = box(minx, miny, maxx, maxy)  # Create Shapely box
        clipped = gpd.clip(gdf, bbox_geom)       # ✅ Actually clips geometry
        # ...
```

**Step 2: Tighten `EUROPE_BOUNDS` to exclude Americas**

File: `init_map_data.py`, Line 66

```python
# BEFORE:
EUROPE_BOUNDS = (-32.0, 30.0, 75.0, 75.0)  # minx too far west

# AFTER (Recommended):
EUROPE_BOUNDS = (-25.0, 34.0, 70.0, 72.0)  # Western limit at Azores, Eastern at Urals
```

**Coordinate Rationale:**
| Bound | Value | Justification |
|-------|-------|---------------|
| minx (West) | -25.0° | Includes Iceland (-24°), excludes Greenland (-40°) |
| miny (South) | 34.0° | Includes Cyprus (34.5°), Crete, excludes North Africa |
| maxx (East) | 70.0° | Includes Ural region (~60°), excludes Siberia |
| maxy (North) | 72.0° | Includes Svalbard, Novaya Zemlya |

---

### REPAIR-02: Implement Tiered Simplification

**Objective:** Apply appropriate simplification tolerances based on feature density/importance.

**Step 1: Define tolerance constants**

File: `init_map_data.py`, add after line 66:

```python
# Simplification tolerances (WGS84 degrees)
SIMPLIFY_NUTS3 = 0.002      # ~220m - preserves NUTS-3 detail
SIMPLIFY_ADMIN1 = 0.02      # ~2.2km - OK for large Russian oblasts
SIMPLIFY_BORDERS = 0.005    # ~550m - smooth national borders
SIMPLIFY_BACKGROUND = 0.03  # ~3.3km - OK for ocean/land backdrop
SIMPLIFY_URBAN = 0.01       # ~1.1km - cities need some detail
SIMPLIFY_PHYSICAL = 0.02    # ~2.2km - mountain ranges OK coarse
```

**Step 2: Apply tolerances by layer**

| Location | Current | Replace With |
|----------|---------|--------------|
| Line 419 (NUTS-3) | `tolerance=0.05` | `tolerance=SIMPLIFY_NUTS3` |
| Line 334 (Admin-1) | `tolerance=0.05` | `tolerance=SIMPLIFY_ADMIN1` |
| Line 220 (Hybrid dissolve) | `tolerance=tolerance` | `tolerance=SIMPLIFY_NUTS3` |
| Line 436-438 (Urban) | `tolerance=0.05` | `tolerance=SIMPLIFY_URBAN` |
| Line 452-453 (Physical) | `tolerance=0.05` | `tolerance=SIMPLIFY_PHYSICAL` |
| Line 483-484 (Borders) | `tolerance=0.05` | `tolerance=SIMPLIFY_BORDERS` |

**Step 3: Update `despeckle_hybrid()` signature**

```python
# BEFORE:
def despeckle_hybrid(
    gdf: gpd.GeoDataFrame, area_km2: float = 500.0, tolerance: float = 0.05
) -> gpd.GeoDataFrame:

# AFTER:
def despeckle_hybrid(
    gdf: gpd.GeoDataFrame, area_km2: float = 500.0, tolerance: float = 0.002
) -> gpd.GeoDataFrame:
```

---

### REPAIR-02B: Smart Filtering (Island Culling)

**Objective:** Aggressively remove geometric noise while protecting inland regions and famous small islands.
This replaces the area-only culling that caused missing inland administrative regions.

**Rule A: Administrative Integrity (Protect Inland Regions)**
- Group geometry by administrative ID.
  - NUTS-3: group by `NUTS_ID` (or `id` after rename).
  - Admin-1: group by `CNTR_CODE` (country-level integrity for eastern extensions).
- ALWAYS KEEP the largest polygon component for each group, even if it falls below the area threshold.

**Rule B: VIP Island Whitelist (Protect Famous Small Islands)**
- If a polygon contains/intersects any VIP point, KEEP it regardless of area.
- VIP Points (lon, lat):
  - Malta: (14.3754, 35.9375)
  - Isle of Wight: (-1.3047, 50.6938)
  - Ibiza: (1.4206, 38.9067)
  - Menorca: (4.1105, 39.9496)
  - Rugen: (13.3915, 54.4174)
  - Bornholm: (14.9141, 55.1270)
  - Jersey: (-2.1312, 49.2144)
  - Aland Islands: (19.9156, 60.1785)

**Rule C: Aggressive Noise Removal**
- For any polygon NOT protected by Rule A or Rule B:
  - DROP if Area < 1000 km^2.

**Implementation Notes (Replace simple area threshold logic)**
- Explode multipart geometries before filtering so per-component logic applies.
- Compute areas in an equal-area projection (e.g., `EPSG:3035`) to get km^2.
- Apply Rule A + Rule B first, then Rule C.

**Suggested Pseudocode (for `despeckle_hybrid` or a new helper):**
```python
VIP_POINTS = [
    ("Malta", (14.3754, 35.9375)),
    ("Isle of Wight", (-1.3047, 50.6938)),
    ("Ibiza", (1.4206, 38.9067)),
    ("Menorca", (4.1105, 39.9496)),
    ("Rugen", (13.3915, 54.4174)),
    ("Bornholm", (14.9141, 55.1270)),
    ("Jersey", (-2.1312, 49.2144)),
    ("Aland Islands", (19.9156, 60.1785)),
]

def smart_island_cull(gdf, group_col, area_km2=1000.0):
    exploded = gdf.explode(index_parts=False, ignore_index=True)
    if exploded.empty:
        return gdf
    projected = exploded.to_crs("EPSG:3035")
    exploded["area_km2"] = projected.geometry.area / 1_000_000.0

    vip_points = [Point(lon, lat) for _, (lon, lat) in VIP_POINTS]
    exploded_ll = exploded.to_crs("EPSG:4326")
    exploded["vip_keep"] = exploded_ll.geometry.apply(
        lambda geom: any(geom.intersects(pt) for pt in vip_points)
    )

    exploded["largest_keep"] = (
        exploded.groupby(group_col)["area_km2"].transform("max") == exploded["area_km2"]
    )
    exploded["keep"] = exploded["largest_keep"] | exploded["vip_keep"] | (
        exploded["area_km2"] >= area_km2
    )
    return exploded.loc[exploded["keep"]].drop(columns=["area_km2", "vip_keep", "largest_keep", "keep"])
```

---

### REPAIR-03: Fix CNTR_CODE Generation Logic

**Objective:** Ensure all features have valid, usable country codes for Auto-Fill.

**Step 1: Fix Admin-1 ID generation to preserve country code**

File: `init_map_data.py`, Lines 316-329

```python
# BEFORE:
if code_col is None:
    admin1["adm1_code"] = (
        admin1.get("name", "adm1").astype(str) + "_" + admin1[iso_col].astype(str)
    )
    code_col = "adm1_code"

# AFTER - Ensure country code is prefix:
if code_col is None:
    admin1["adm1_code"] = (
        admin1[iso_col].astype(str) + "_" + admin1.get("name", "adm1").astype(str)
    )  # Format: "RU_Moscow" so [:2] extracts "RU"
    code_col = "adm1_code"
```

**Step 2: Robust CNTR_CODE fallback extraction**

File: `init_map_data.py`, Lines 475-480

```python
# BEFORE:
final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[
    missing_mask, "id"
].astype(str).str[:2]

# AFTER - Handle multiple ID formats:
def extract_country_code(id_val):
    s = str(id_val)
    if "_" in s:
        # Format: "RU_Moscow" or "Moscow_RU"
        parts = s.split("_")
        for part in parts:
            if len(part) == 2 and part.isupper():
                return part
    # Fallback: first 2 chars (NUTS format "DE123")
    return s[:2].upper() if len(s) >= 2 else ""

final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[
    missing_mask, "id"
].apply(extract_country_code)
```

**Step 3: Expand `countryPalette` in frontend**

File: `js/app.js`, Lines 44-58

```javascript
const countryPalette = {
  // Original entries
  DE: "#5d7cba", FR: "#4a90e2", IT: "#50e3c2", PL: "#f5a623",
  NL: "#7ed321", BE: "#bd10e0", LU: "#8b572a", AT: "#417505",
  CH: "#d0021b", UA: "#6b8fd6", BY: "#9b5de5", MD: "#f28482",
  RU: "#4a4e69",
  // NEW: Missing European countries
  ES: "#e74c3c", PT: "#9b59b6", CZ: "#3498db", SK: "#1abc9c",
  HU: "#e67e22", RO: "#2ecc71", BG: "#f39c12", HR: "#16a085",
  SI: "#27ae60", EE: "#2980b9", LV: "#8e44ad", LT: "#c0392b",
  FI: "#d35400", SE: "#7f8c8d", NO: "#34495e", DK: "#95a5a6",
  IE: "#1e8449", UK: "#5d6d7e", GB: "#5d6d7e", GR: "#148f77",
  CY: "#d68910", MT: "#a93226", TR: "#b03a2e", RS: "#6c3483",
  BA: "#1a5276", ME: "#117a65", AL: "#b9770e", MK: "#7d3c98",
  XK: "#2e4053", IS: "#5499c7", LI: "#45b39d",
};
```

---

### REPAIR-04: Optimize Frontend Rendering

**Objective:** Reduce lag during hover and pan/zoom interactions.

**Step 1: Debounce hit-canvas updates**

File: `js/app.js`, modify `drawHidden()`:

```javascript
let hitCanvasDirty = true;

function markHitDirty() {
  hitCanvasDirty = true;
}

function drawHidden() {
  if (!hitCanvasDirty) return;  // Skip if already up-to-date
  hitCanvasDirty = false;
  // ... existing code ...
}
```

Call `markHitDirty()` at end of `renderFull()`.

**Step 2: Use requestAnimationFrame for zoom renders**

File: `js/app.js`, Lines 577-591

```javascript
// BEFORE:
.on("zoom", (event) => {
    zoomTransform = event.transform;
    renderFull();  // Called every frame
})

// AFTER:
let zoomRenderScheduled = false;

.on("zoom", (event) => {
    zoomTransform = event.transform;
    if (!zoomRenderScheduled) {
        zoomRenderScheduled = true;
        requestAnimationFrame(() => {
            renderFull();
            zoomRenderScheduled = false;
        });
    }
})
```

**Step 3: Throttle mousemove handler**

File: `js/app.js`, Line 319:

```javascript
// BEFORE:
function handleMouseMove(event) {
  if (!landData) return;
  if (isInteracting) return;
  const id = getFeatureIdFromEvent(event);
  // ...
}

// AFTER:
let lastMouseMoveTime = 0;
const MOUSE_THROTTLE_MS = 16;  // ~60fps max

function handleMouseMove(event) {
  const now = performance.now();
  if (now - lastMouseMoveTime < MOUSE_THROTTLE_MS) return;
  lastMouseMoveTime = now;

  if (!landData) return;
  if (isInteracting) return;
  const id = getFeatureIdFromEvent(event);
  // ...
}
```

---

## Section 3: Architect's Opinion & Direction

### Project State Assessment

The Map Creator has solid architectural foundations (dual-canvas rendering, color-indexed hit detection, tiered layer system) but the Europe expansion was executed without adjusting parameters for the increased geographic scope and data complexity.

**Current State:** UNSTABLE - Not suitable for production or demo.

**Technical Debt Severity:** MEDIUM - Issues are parameter/logic bugs, not architectural flaws.

### Immediate Priority (Ordered)

1. **REPAIR-01 (Bounding Box)** - Blocks all other testing; cannot validate map without excluding Americas
2. **REPAIR-02 (Simplification)** - Topology corruption makes visual QA impossible
3. **REPAIR-03 (Country Codes)** - Feature parity restoration
4. **REPAIR-04 (Performance)** - UX polish, can be deferred if needed

### Limited Test Criterion (Definition of Done)

After repairs, the following assertions MUST pass:

```
✅ GEOJSON_SIZE:     europe_final_optimized.geojson < 5 MB
✅ WEST_HEMISPHERE:  No features with centroid longitude < -30°
✅ EAST_BOUNDARY:    No features with centroid longitude > 75°
✅ TOPOLOGY_INTACT:  Germany has exactly 401 NUTS-3 regions (source: Eurostat)
✅ CNTR_CODE_FILL:   0 features with empty cntr_code property
✅ RENDER_FPS:       60 FPS during continuous pan (Chrome DevTools)
✅ AUTO_FILL:        "Auto-Fill Countries" colors >95% of visible regions
```

### Recommended Testing Procedure

1. Delete `data/*.geojson` to force regeneration
2. Run `python init_map_data.py`
3. Verify file sizes: `ls -lh data/`
4. Open `index.html` in browser
5. Visual check: No Americas visible
6. Visual check: Germany counties are distinct, not shattered
7. Click "Auto-Fill Countries" - verify coloring
8. Pan/zoom - verify no lag

### File Size Budget

| File | Max Size | Purpose |
|------|----------|---------|
| europe_final_optimized.geojson | 5 MB | Interactive layer |
| europe_countries_combined.geojson | 1 MB | Border overlays |
| europe_rivers.geojson | 2 MB | River lines |
| europe_land_bg.geojson | 1 MB | Background fill |
| europe_ocean.geojson | 500 KB | Ocean fill |
| europe_urban.geojson | 1 MB | Urban overlays |
| europe_physical.geojson | 1 MB | Mountain/forest regions |
| **TOTAL** | **<12 MB** | All assets |

---

## Appendix A: Quick Reference - Key Line Numbers

| File | Line | Issue |
|------|------|-------|
| init_map_data.py | 66 | EUROPE_BOUNDS definition |
| init_map_data.py | 177 | `.cx[]` used instead of `gpd.clip()` |
| init_map_data.py | 188 | despeckle tolerance param |
| init_map_data.py | 220 | Dissolve simplification |
| init_map_data.py | 334 | Admin-1 simplification |
| init_map_data.py | 419 | NUTS-3 simplification |
| init_map_data.py | 475-480 | CNTR_CODE extraction |
| js/app.js | 44-58 | countryPalette |
| js/app.js | 313 | getImageData call |
| js/app.js | 521 | cntr_code check |
| js/app.js | 585 | zoom render call |

---

**End of Audit Report**

*Document ID: QA-001*
*Classification: Internal Engineering*
*Next Review: After REPAIR-01 through REPAIR-04 implemented*
