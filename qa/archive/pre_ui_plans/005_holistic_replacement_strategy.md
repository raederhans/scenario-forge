# Phase 4: Holistic Country Replacement Strategy

**Document Version:** 1.0
**Phase:** Data Architecture Pivot
**Strategy:** Replace entire countries with Admin Level 2 data instead of surgical stitching

---

## Executive Summary

The previous "Surgical Stitching" approach (mixing NUTS-3 and arrondissement data) creates border artifacts and visual inconsistencies. This document proposes a **Holistic Country Replacement** strategy where target countries are completely replaced with higher-granularity administrative data.

**Target Countries:**
| Country | Current Level | Target Level | Features |
|---------|--------------|--------------|----------|
| France | NUTS-3 (Départements) | Arrondissements | ~333 |
| Poland | NUTS-3 (Powiaty) | Powiaty | ~380 (already at target) |
| Ukraine | Oblasts | Raions (pre-2020) | ~490 |

**Key Finding:** Poland NUTS-3 data IS already at Powiat level - no replacement needed!

---

## Section 1: Data Source Audit

### 1.1 France - Arrondissements

| Attribute | Value |
|-----------|-------|
| **Source** | [gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson) |
| **Direct URL** | `https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/arrondissements.geojson` |
| **Feature Count** | **333** arrondissements (metropolitan + overseas) |
| **Coverage** | Full metropolitan France + DOM-TOM |
| **CRS** | WGS84 (EPSG:4326) |
| **Properties** | `code` (INSEE), `nom` (French name) |
| **License** | IGN Admin Express (Open License) |
| **File Size** | ~2.5 MB |

**Status:** CONFIRMED - Ready for full country replacement

**Code Pattern:**
```
Arrondissement code: DDAAA
  DD  = Department number (01-95, 2A, 2B, 97x)
  AAA = Arrondissement index (001-00n)

Example: 75001 = Paris 1st arr., 13001 = Marseille arr.
```

### 1.2 Poland - Powiaty (Counties)

| Attribute | Value |
|-----------|-------|
| **Source** | [ppatrzyk/polska-geojson](https://github.com/ppatrzyk/polska-geojson) |
| **Direct URL** | `https://github.com/ppatrzyk/polska-geojson/raw/master/powiaty/powiaty-medium.geojson` |
| **Alternative** | [jusuff/PolandGeoJson](https://github.com/jusuff/PolandGeoJson) |
| **Feature Count** | **380** powiaty (314 land + 66 city counties) |
| **CRS** | WGS84 (EPSG:4326) |
| **License** | MIT |
| **File Sizes** | min: 377KB, medium: 7MB, max: 40MB |

**Critical Discovery:**
Poland's NUTS-3 classification already corresponds to Powiat level!
- NUTS-3 Poland = Powiaty + cities with powiat status
- **No replacement needed** - existing data is already at target granularity

**Recommendation:** Verify current `europe_topology.json` Poland feature count. If ~380, no action required.

### 1.3 Ukraine - Raions (Districts)

| Attribute | Value |
|-----------|-------|
| **Target** | Pre-2020 Reform Raions (~490 districts) |
| **Challenge** | 2020 reform merged 490 raions into 136 |
| **Best Source** | [GADM 3.6](https://gadm.org/download_country_v3.html) (pre-2020) |
| **Format** | Shapefile (requires conversion to GeoJSON) |
| **Feature Count** | **~490** raions + special cities |
| **Alternative** | [HDX Ukraine Boundaries](https://data.humdata.org/dataset/cod-ab-ukr) (post-2020) |

**GADM 3.6 Download:**
```
URL Pattern: https://biogeo.ucdavis.edu/data/gadm3.6/shp/gadm36_UKR_shp.zip
Level 2 = Raions (pre-2020 boundaries)
```

**Conversion Required:**
```bash
# Using ogr2ogr (GDAL)
ogr2ogr -f GeoJSON ukraine_raions.geojson gadm36_UKR_2.shp -t_srs EPSG:4326

# Or using mapshaper
mapshaper gadm36_UKR_2.shp -simplify 15% -o format=geojson ukraine_raions.geojson
```

**License Warning:** GADM data is free for academic/non-commercial use. Redistribution requires permission.

---

## Section 2: Feasibility Analysis

### 2.1 Polygon Count Assessment

| Layer | Current Count | After Replacement | Delta |
|-------|--------------|-------------------|-------|
| France NUTS-3 | ~96 | 333 (arrondissements) | +237 |
| Poland NUTS-3 | ~380 | 380 (no change) | 0 |
| Ukraine Oblasts | ~25 | ~490 (raions) | +465 |
| Rest of Europe | ~1800 | ~1800 (no change) | 0 |
| **TOTAL** | ~2300 | ~3000 | **+700** |

### 2.2 Browser Performance Risk Assessment

| Metric | Threshold | Projected | Status |
|--------|-----------|-----------|--------|
| Total Features | 5000-8000 safe | ~3000 | **SAFE** |
| TopoJSON Size | <10 MB | ~4-5 MB | **SAFE** |
| Canvas Render | 60fps target | Expected OK | **LOW RISK** |
| Hit Detection | <50ms | Expected OK | **LOW RISK** |

**Verdict:** Full replacement of France + Ukraine is **FEASIBLE** within performance budget.

### 2.3 Data Quality Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| GADM 3.6 unavailable | HIGH | Cache locally, use HDX fallback (post-2020) |
| Border misalignment FR/ES | MEDIUM | Implement stroke customization (see Section 4) |
| Property schema mismatch | LOW | Normalize in Python pipeline |
| Pre-2020 Ukraine data loss | MEDIUM | Archive GADM 3.6 data immediately |

---

## Section 3: Implementation Plan

### 3.1 Priority Order

1. **Phase 4A: France Full Replacement** (LOW RISK)
   - Data source confirmed
   - Direct GeoJSON download
   - +237 features

2. **Phase 4B: Ukraine Full Replacement** (MEDIUM RISK)
   - Requires GADM 3.6 download + conversion
   - Pre-2020 data critical for historical scenarios
   - +465 features

3. **Phase 4C: Poland Verification** (NO ACTION)
   - Verify existing data is already at Powiat level
   - If yes, no changes needed

### 3.2 Python Pipeline Changes (`init_map_data.py`)

```python
# === NEW CONSTANTS ===

# France: Full arrondissement replacement
FR_ARROND_URL = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/arrondissements.geojson"

# Ukraine: Pre-2020 Raions (local file after GADM conversion)
UA_RAIONS_PATH = "data/sources/ukraine_raions_gadm36.geojson"

# Countries to fully replace (remove all NUTS features for these)
FULL_REPLACE_COUNTRIES = {"FR", "UA"}

def fetch_france_full() -> gpd.GeoDataFrame:
    """
    Download ALL France arrondissements to replace entire country.
    """
    print("Downloading France arrondissements (full replacement)...")
    response = requests.get(FR_ARROND_URL, timeout=(10, 120))
    response.raise_for_status()
    gdf = gpd.GeoDataFrame.from_features(response.json().get("features", []))
    gdf = gdf.set_crs("EPSG:4326", allow_override=True)

    # Standardize properties
    gdf["id"] = "FR_ARR_" + gdf["code"].astype(str)
    gdf["name"] = gdf["nom"]
    gdf["cntr_code"] = "FR"

    # Simplify geometry
    gdf["geometry"] = gdf.geometry.simplify(tolerance=0.001, preserve_topology=True)

    print(f"Loaded {len(gdf)} French arrondissements")
    return gdf[["id", "name", "cntr_code", "geometry"]]

def load_ukraine_raions() -> gpd.GeoDataFrame:
    """
    Load pre-2020 Ukraine raions from local GADM 3.6 converted file.
    """
    if not Path(UA_RAIONS_PATH).exists():
        print(f"WARNING: Ukraine raions file not found: {UA_RAIONS_PATH}")
        return gpd.GeoDataFrame()

    print("Loading Ukraine raions (pre-2020 GADM 3.6)...")
    gdf = gpd.read_file(UA_RAIONS_PATH)
    gdf = gdf.to_crs("EPSG:4326")

    # Standardize properties (GADM uses NAME_2 for raion names)
    gdf["id"] = "UA_RAI_" + gdf["GID_2"].astype(str)
    gdf["name"] = gdf["NAME_2"]
    gdf["cntr_code"] = "UA"

    # Simplify geometry
    gdf["geometry"] = gdf.geometry.simplify(tolerance=0.001, preserve_topology=True)

    print(f"Loaded {len(gdf)} Ukrainian raions")
    return gdf[["id", "name", "cntr_code", "geometry"]]

def apply_full_replacements(base_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Remove all features for target countries, replace with Admin-2 data.
    """
    # Remove existing features for replacement countries
    mask = ~base_gdf["cntr_code"].isin(FULL_REPLACE_COUNTRIES)
    result = base_gdf[mask].copy()
    print(f"Removed {(~mask).sum()} features for countries: {FULL_REPLACE_COUNTRIES}")

    # Add France arrondissements
    france = fetch_france_full()
    if not france.empty:
        result = gpd.GeoDataFrame(
            pd.concat([result, france], ignore_index=True),
            crs=result.crs
        )

    # Add Ukraine raions
    ukraine = load_ukraine_raions()
    if not ukraine.empty:
        result = gpd.GeoDataFrame(
            pd.concat([result, ukraine], ignore_index=True),
            crs=result.crs
        )

    return result
```

### 3.3 ID Schema

| Country | Pattern | Example |
|---------|---------|---------|
| France Arrondissements | `FR_ARR_{code}` | `FR_ARR_75001` (Paris 1st) |
| Ukraine Raions | `UA_RAI_{GID_2}` | `UA_RAI_UKR.14.1_1` |
| Poland Powiaty | `PL{NUTS3}` | `PL911` (existing) |
| Other NUTS-3 | `{NUTS_ID}` | `DE111`, `ES511` |

---

## Section 4: Visual Style Panel Architecture

### 4.1 Problem Statement

Even with full country replacement, minor border misalignments may occur between countries (e.g., France arrondissements vs. Spain NUTS-3). Customizable stroke styles can mask these artifacts.

### 4.2 Configurable Parameters

| Parameter | Default | Range | Purpose |
|-----------|---------|-------|---------|
| `internalBorderColor` | `#e2e8f0` | Any hex | Color for same-country borders |
| `internalBorderWidth` | `0.5` | 0.1 - 2.0 | Width of internal borders |
| `externalBorderColor` | `#475569` | Any hex | Color for country boundaries |
| `externalBorderWidth` | `1.0` | 0.5 - 3.0 | Width of country boundaries |
| `coastlineColor` | `#333333` | Any hex | Color for coastlines |
| `coastlineWidth` | `1.2` | 0.5 - 3.0 | Width of coastlines |
| `coloredBorderWidth` | `1.0` | 0.5 - 2.0 | Width for colored region borders |

### 4.3 JavaScript Implementation

Add to `js/app.js`:

```javascript
// === VISUAL STYLE CONFIGURATION ===
const strokeStyles = {
  internalBorder: { color: "#e2e8f0", width: 0.5 },
  externalBorder: { color: "#475569", width: 1.0 },
  coastline: { color: "#333333", width: 1.2 },
  coloredBorder: { color: "#475569", width: 1.0 },
  hover: { color: "#f1c40f", width: 2.0 },
};

function updateStrokeStyle(category, property, value) {
  if (strokeStyles[category]) {
    strokeStyles[category][property] = value;
    invalidateBorderCache();
    renderFull();
  }
}
```

Update `renderLineLayer()`:

```javascript
function renderLineLayer() {
  // ... existing code ...

  const k = zoomTransform.k;

  // Coastlines
  if (coastlines) {
    lineCtx.beginPath();
    linePath(coastlines);
    lineCtx.strokeStyle = strokeStyles.coastline.color;
    lineCtx.lineWidth = strokeStyles.coastline.width / k;
    lineCtx.stroke();
  }

  // Internal grid lines (same-color regions)
  if (gridLines) {
    lineCtx.beginPath();
    linePath(gridLines);
    lineCtx.strokeStyle = strokeStyles.internalBorder.color;
    lineCtx.lineWidth = strokeStyles.internalBorder.width / k;
    lineCtx.stroke();
  }

  // External borders (different-color regions)
  if (dynamicBorders) {
    lineCtx.beginPath();
    linePath(dynamicBorders);
    lineCtx.strokeStyle = strokeStyles.externalBorder.color;
    lineCtx.lineWidth = strokeStyles.externalBorder.width / k;
    lineCtx.stroke();
  }

  // ... rest of function ...
}
```

### 4.4 UI Panel (HTML)

```html
<div class="space-y-3">
  <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
    Border Styles
  </div>

  <div class="grid grid-cols-2 gap-2">
    <div>
      <label class="text-xs text-slate-500">Internal Color</label>
      <input type="color" id="styleInternalColor" value="#e2e8f0"
             class="h-8 w-full rounded border border-slate-300">
    </div>
    <div>
      <label class="text-xs text-slate-500">Internal Width</label>
      <input type="range" id="styleInternalWidth" min="0.1" max="2" step="0.1" value="0.5"
             class="w-full">
    </div>

    <div>
      <label class="text-xs text-slate-500">External Color</label>
      <input type="color" id="styleExternalColor" value="#475569"
             class="h-8 w-full rounded border border-slate-300">
    </div>
    <div>
      <label class="text-xs text-slate-500">External Width</label>
      <input type="range" id="styleExternalWidth" min="0.5" max="3" step="0.1" value="1.0"
             class="w-full">
    </div>

    <div>
      <label class="text-xs text-slate-500">Coastline Color</label>
      <input type="color" id="styleCoastColor" value="#333333"
             class="h-8 w-full rounded border border-slate-300">
    </div>
    <div>
      <label class="text-xs text-slate-500">Coastline Width</label>
      <input type="range" id="styleCoastWidth" min="0.5" max="3" step="0.1" value="1.2"
             class="w-full">
    </div>
  </div>
</div>
```

---

## Section 5: Testing Checklist

### 5.1 Data Pipeline

- [ ] France arrondissements download succeeds
- [ ] All 333 arrondissements present in output
- [ ] France NUTS-3 features removed (count = 0)
- [ ] Ukraine raions loaded from GADM 3.6 conversion
- [ ] ~490 raions present in output
- [ ] Ukraine oblasts removed
- [ ] Poland feature count unchanged (~380)
- [ ] TopoJSON file size < 6 MB
- [ ] No duplicate IDs

### 5.2 Frontend Rendering

- [ ] France renders with arrondissement boundaries
- [ ] Ukraine renders with raion boundaries
- [ ] No visible gaps between countries
- [ ] Stroke style controls functional
- [ ] Adjusting stroke width hides minor misalignments
- [ ] Performance remains smooth (60fps)

### 5.3 Historical Scenarios

- [ ] Vichy France demarcation line drawable
- [ ] Alsace-Lorraine (1871) drawable
- [ ] Western Ukraine/Poland historical borders possible
- [ ] TNO Burgundy Seine line possible

---

## Appendix A: GADM 3.6 Ukraine Conversion Script

```bash
#!/bin/bash
# convert_ukraine_gadm.sh
# Converts GADM 3.6 Ukraine Level 2 to GeoJSON

set -e

GADM_URL="https://biogeo.ucdavis.edu/data/gadm3.6/shp/gadm36_UKR_shp.zip"
OUTPUT_DIR="data/sources"
OUTPUT_FILE="ukraine_raions_gadm36.geojson"

mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

# Download GADM shapefile
echo "Downloading GADM 3.6 Ukraine..."
curl -L -o gadm36_UKR_shp.zip "$GADM_URL"

# Extract
unzip -o gadm36_UKR_shp.zip

# Convert Level 2 (Raions) to GeoJSON with simplification
echo "Converting to GeoJSON..."
ogr2ogr -f GeoJSON \
  -t_srs EPSG:4326 \
  -simplify 0.001 \
  "$OUTPUT_FILE" \
  gadm36_UKR_2.shp

# Cleanup
rm -f gadm36_UKR_*.shp gadm36_UKR_*.shx gadm36_UKR_*.dbf gadm36_UKR_*.prj gadm36_UKR_*.cpg
rm -f gadm36_UKR_shp.zip

echo "Done! Output: $OUTPUT_DIR/$OUTPUT_FILE"

# Verify feature count
python3 -c "
import json
with open('$OUTPUT_FILE') as f:
    data = json.load(f)
    print(f'Feature count: {len(data[\"features\"])}')
"
```

---

## Appendix B: Feature Count Summary

| Layer | Count | ID Pattern |
|-------|-------|------------|
| France Arrondissements | 333 | `FR_ARR_*` |
| Ukraine Raions (pre-2020) | ~490 | `UA_RAI_*` |
| Poland Powiaty (existing) | 380 | `PL*` |
| Germany NUTS-3 | ~401 | `DE*` |
| Spain NUTS-3 | ~59 | `ES*` |
| Italy NUTS-3 | ~107 | `IT*` |
| Rest of Europe | ~1230 | Various |
| **TOTAL** | **~3000** | |

---

## Appendix C: Data Source URLs

| Country | Source | URL |
|---------|--------|-----|
| France | gregoiredavid/france-geojson | `https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/arrondissements.geojson` |
| Poland | ppatrzyk/polska-geojson | `https://github.com/ppatrzyk/polska-geojson/raw/master/powiaty/powiaty-medium.geojson` |
| Ukraine | GADM 3.6 | `https://biogeo.ucdavis.edu/data/gadm3.6/shp/gadm36_UKR_shp.zip` |

---

*End of Holistic Country Replacement Strategy*
