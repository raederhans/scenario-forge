# Feature Specification: Phase 16 UI Expansion & Data Fixes

**Spec Date:** 2026-01-25
**Author:** Lead Product Architect & GIS Specialist
**Status:** READY FOR IMPLEMENTATION
**Prerequisites:** QA-001 repairs must be complete (bounding box, simplification, CNTR_CODE fixes)

---

## Executive Summary

This specification covers three enhancements to bring the Map Creator to production quality:

| Feature | Priority | Complexity | Files Affected |
|---------|----------|------------|----------------|
| FEAT-01: Right-Hand Customization Panel | HIGH | Medium | `index.html`, `js/app.js` |
| FEAT-02: Balkan Data Gap (BA, XK) | HIGH | Medium | `init_map_data.py` |
| FEAT-03: Border Rendering Optimization | MEDIUM | Low | `init_map_data.py`, `js/app.js` |

---

## Section 1: Issue Analysis

### Current State Assessment

**UI Limitation:** The `countryPalette` in [js/app.js:44-89](js/app.js#L44-L89) is hardcoded. Users cannot customize country colors without editing source code. The "Auto-Fill Countries" feature applies preset colors with no user control.

**Data Gap:** Bosnia and Herzegovina (BA) and Kosovo (XK) are missing from the interactive layer. The `EXTENSION_COUNTRIES` set at [init_map_data.py:64](init_map_data.py#L64) only includes `{"RU", "UA", "BY", "MD"}`. The Balkans are not covered by NUTS-3 data (EU members only) nor by the current Admin-1 extension.

**Border Rendering Flaw:** The current border layer uses `ne_10m_admin_0_countries` polygons ([init_map_data.py:56](init_map_data.py#L56)). When polygon boundaries are stroked, ALL edges are drawn—including coastlines. This creates thick, ugly overlaps along complex coastlines (Norway fjords, Greek islands, UK).

---

## Section 2: Implementation Specification

---

### FEAT-01: Right-Hand Customization Panel

**Objective:** Allow users to customize country colors dynamically via a right-hand sidebar.

---

#### FEAT-01-A: HTML Structure

**File:** `index.html`

**Location:** After `</aside>` (left sidebar), before `<main>` (line 187)

**Add the following HTML block:**

```html
<aside id="rightSidebar" class="w-[280px] shrink-0 border-l border-slate-200 bg-white p-4 max-h-screen overflow-y-auto hidden lg:block">
  <div class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold tracking-tight text-slate-900">Country Colors</h2>
      <p class="mt-1 text-xs text-slate-500">
        Customize colors for Auto-Fill. Changes apply immediately.
      </p>
    </div>

    <div class="relative">
      <input
        id="countrySearch"
        type="text"
        placeholder="Search countries..."
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
      />
    </div>

    <div id="countryList" class="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
      <!-- Dynamically populated -->
    </div>

    <div class="border-t border-slate-200 pt-4">
      <button
        id="resetPaletteBtn"
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Reset to Defaults
      </button>
    </div>
  </div>
</aside>
```

**CSS Consideration:** The `<main>` element needs width adjustment. Update its class:
```html
<!-- BEFORE -->
<main class="relative flex-1 bg-slate-100">

<!-- AFTER -->
<main class="relative flex-1 min-w-0 bg-slate-100">
```

---

#### FEAT-01-B: JavaScript - Country List Generation

**File:** `js/app.js`

**Step 1: Add country name mapping (after `countryPalette` definition, ~line 89)**

```javascript
const countryNames = {
  DE: "Germany", FR: "France", IT: "Italy", PL: "Poland",
  NL: "Netherlands", BE: "Belgium", LU: "Luxembourg", AT: "Austria",
  CH: "Switzerland", UA: "Ukraine", BY: "Belarus", MD: "Moldova",
  RU: "Russia", ES: "Spain", PT: "Portugal", CZ: "Czechia",
  SK: "Slovakia", HU: "Hungary", RO: "Romania", BG: "Bulgaria",
  HR: "Croatia", SI: "Slovenia", EE: "Estonia", LV: "Latvia",
  LT: "Lithuania", FI: "Finland", SE: "Sweden", NO: "Norway",
  DK: "Denmark", IE: "Ireland", UK: "United Kingdom", GB: "United Kingdom",
  GR: "Greece", CY: "Cyprus", MT: "Malta", TR: "Turkey",
  RS: "Serbia", BA: "Bosnia & Herzegovina", ME: "Montenegro",
  AL: "Albania", MK: "North Macedonia", XK: "Kosovo",
  IS: "Iceland", LI: "Liechtenstein",
};
```

**Step 2: Add state variable for default palette backup (after line 106)**

```javascript
const defaultPalette = { ...countryPalette };
```

**Step 3: Create `buildCountryList()` function (add before `setupUI()`)**

```javascript
function buildCountryList() {
  const container = document.getElementById("countryList");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetPaletteBtn");

  if (!container) return;

  // Extract unique country codes from loaded map data
  const countryCodes = new Set();
  if (landData) {
    for (const feature of landData.features) {
      const cntr = feature.properties?.cntr_code || feature.properties?.CNTR_CODE;
      if (cntr && cntr.length === 2) {
        countryCodes.add(cntr.toUpperCase());
      }
    }
  }

  // Sort alphabetically by country name
  const sortedCodes = Array.from(countryCodes).sort((a, b) => {
    const nameA = countryNames[a] || a;
    const nameB = countryNames[b] || b;
    return nameA.localeCompare(nameB);
  });

  function renderList(filter = "") {
    container.innerHTML = "";
    const lowerFilter = filter.toLowerCase();

    for (const code of sortedCodes) {
      const name = countryNames[code] || code;
      if (filter && !name.toLowerCase().includes(lowerFilter) && !code.toLowerCase().includes(lowerFilter)) {
        continue;
      }

      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2";
      row.dataset.code = code;

      const label = document.createElement("span");
      label.className = "text-sm font-medium text-slate-700 truncate";
      label.textContent = name;
      label.title = `${name} (${code})`;

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white";
      colorInput.value = countryPalette[code] || "#cccccc";
      colorInput.dataset.code = code;

      colorInput.addEventListener("input", (e) => {
        const newColor = e.target.value;
        countryPalette[code] = newColor;
        applyCountryPaletteToMap();
      });

      row.appendChild(label);
      row.appendChild(colorInput);
      container.appendChild(row);
    }

    if (container.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-sm text-slate-500 text-center py-4";
      empty.textContent = "No countries found";
      container.appendChild(empty);
    }
  }

  renderList();

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderList(e.target.value);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      Object.assign(countryPalette, defaultPalette);
      renderList(searchInput?.value || "");
      applyCountryPaletteToMap();
    });
  }
}

function applyCountryPaletteToMap() {
  if (!landData) return;
  for (const feature of landData.features) {
    const id = feature.properties?.id || feature.properties?.NUTS_ID;
    const cntr = feature.properties?.cntr_code || feature.properties?.CNTR_CODE;
    if (!id || !cntr) continue;
    const color = countryPalette[cntr];
    if (color && colors[id]) {
      // Only update regions that were previously filled by Auto-Fill
      colors[id] = color;
    }
  }
  renderFull();
}
```

**Step 4: Call `buildCountryList()` after data loads**

**File:** `js/app.js`, in `loadData()` function (~line 614), add after `renderFull();`:

```javascript
buildCountryList();
```

---

#### FEAT-01-C: Acceptance Criteria

| Test | Expected Result |
|------|-----------------|
| Page load | Right sidebar appears with scrollable country list |
| Color picker change | Map updates immediately if that country was Auto-Filled |
| Search "Ger" | Only Germany appears in list |
| Clear search | All countries reappear |
| Reset button | All colors revert to original palette |
| Responsive | Sidebar hidden on screens < 1024px (`lg:block`) |

---

### FEAT-02: Balkan Data Gap (Bosnia & Kosovo)

**Objective:** Include Bosnia and Herzegovina (BA) and Kosovo (XK) in the interactive map layer.

---

#### FEAT-02-A: Expand Extension Countries

**File:** `init_map_data.py`

**Line 64:** Update `EXTENSION_COUNTRIES` set:

```python
# BEFORE:
EXTENSION_COUNTRIES = {"RU", "UA", "BY", "MD"}

# AFTER:
EXTENSION_COUNTRIES = {"RU", "UA", "BY", "MD", "BA", "XK", "RS", "ME", "AL", "MK"}
```

**Rationale:** Include all Western Balkans non-EU countries that are missing from NUTS-3.

---

#### FEAT-02-B: Modify `build_extension_admin1()` for Balkans

**File:** `init_map_data.py`

**Problem:** The current function filters Admin-1 data but Kosovo (`XK`) has special handling needs. Natural Earth may code Kosovo as `-99` or `XK` depending on version. Bosnia's Admin-1 subdivisions (Federation, Republika Srpska) may be incomplete.

**Replace the filter logic in `build_extension_admin1()` (~lines 392-395):**

```python
# BEFORE:
admin1 = admin1[
    admin1[iso_col].isin(EXTENSION_COUNTRIES)
    | admin1[name_col].isin({"Russia", "Ukraine", "Belarus", "Moldova"})
].copy()

# AFTER:
balkan_names = {
    "Bosnia and Herzegovina", "Bosnia and Herz.", "Bosnia-Herzegovina",
    "Kosovo", "Serbia", "Montenegro", "Albania", "North Macedonia", "Macedonia",
}
extension_names = {"Russia", "Ukraine", "Belarus", "Moldova"} | balkan_names

admin1 = admin1[
    admin1[iso_col].isin(EXTENSION_COUNTRIES)
    | admin1[name_col].isin(extension_names)
].copy()

# Handle Kosovo's special ISO code (-99 in some NE versions)
kosovo_mask = admin1[name_col].str.contains("Kosovo", case=False, na=False)
admin1.loc[kosovo_mask, iso_col] = "XK"
```

---

#### FEAT-02-C: Country-Level Fallback for Problematic Regions

**File:** `init_map_data.py`

**Problem:** If Admin-1 data is missing or malformed for Kosovo/Bosnia, we need a fallback to country-level (`ne_10m_admin_0_countries`).

**Add a new helper function after `build_extension_admin1()`:**

```python
def build_balkan_fallback(existing_hybrid: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Fallback: If BA or XK are missing from hybrid, extract from admin-0 countries.
    """
    required_codes = {"BA", "XK"}
    existing_codes = set(existing_hybrid["cntr_code"].dropna().unique())
    missing_codes = required_codes - existing_codes

    if not missing_codes:
        print(f"Balkan fallback: BA and XK already present, skipping.")
        return existing_hybrid

    print(f"Balkan fallback: Fetching country-level data for {missing_codes}...")

    countries = fetch_ne_zip(BORDERS_URL, "countries_fallback")
    countries = countries.to_crs("EPSG:4326")
    countries = clip_to_europe_bounds(countries, "countries_fallback")

    iso_col = pick_column(countries, ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2"])
    name_col = pick_column(countries, ["name", "NAME", "admin", "ADMIN"])

    if not iso_col:
        print("Balkan fallback: Cannot find ISO column in countries dataset.")
        return existing_hybrid

    # Fix Kosovo code if needed
    if "XK" in missing_codes:
        kosovo_mask = countries[name_col].str.contains("Kosovo", case=False, na=False)
        countries.loc[kosovo_mask, iso_col] = "XK"

    fallback = countries[countries[iso_col].isin(missing_codes)].copy()

    if fallback.empty:
        print(f"Balkan fallback: No features found for {missing_codes}.")
        return existing_hybrid

    # Standardize columns to match hybrid schema
    fallback = fallback.rename(columns={
        iso_col: "cntr_code",
        name_col: "name",
    })
    fallback["id"] = fallback["cntr_code"] + "_country"
    fallback = fallback[["id", "name", "cntr_code", "geometry"]].copy()
    fallback["geometry"] = fallback.geometry.simplify(
        tolerance=SIMPLIFY_ADMIN1, preserve_topology=True
    )

    print(f"Balkan fallback: Adding {len(fallback)} country-level features.")

    combined = gpd.GeoDataFrame(
        pd.concat([existing_hybrid, fallback], ignore_index=True),
        crs="EPSG:4326",
    )
    return combined
```

**Call the fallback in `main()` after building `hybrid` (~line 584):**

```python
# BEFORE:
final_hybrid = smart_island_cull(hybrid, group_col="id", threshold_km2=1000.0)

# AFTER:
hybrid = build_balkan_fallback(hybrid)
final_hybrid = smart_island_cull(hybrid, group_col="id", threshold_km2=1000.0)
```

---

#### FEAT-02-D: Acceptance Criteria

| Test | Expected Result |
|------|-----------------|
| Generate data | `europe_final_optimized.geojson` contains features with `cntr_code: "BA"` |
| Generate data | `europe_final_optimized.geojson` contains features with `cntr_code: "XK"` |
| Auto-Fill | Bosnia fills with color `#1a5276` |
| Auto-Fill | Kosovo fills with color `#2e4053` |
| Visual check | No gaps in Western Balkans region |

---

### FEAT-03: Border Rendering Optimization

**Objective:** Replace polygon-based borders with dedicated land boundary lines to eliminate coastline overlap.

---

#### FEAT-03-A: New Data Source

**File:** `init_map_data.py`

**Step 1: Add new URL constant (after line 61):**

```python
BORDER_LINES_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_boundary_lines_land.zip"
```

**Step 2: Add simplification tolerance for border lines:**

```python
SIMPLIFY_BORDER_LINES = 0.003  # Finer than polygons, ~330m
```

---

#### FEAT-03-B: New Border Processing Function

**File:** `init_map_data.py`

**Add after `clip_borders()` function (~line 377):**

```python
def build_border_lines() -> gpd.GeoDataFrame:
    """
    Fetch and process land-only international boundary lines.
    This excludes coastlines, producing cleaner border rendering.
    """
    print("Building border lines layer (land boundaries only)...")

    borders = fetch_ne_zip(BORDER_LINES_URL, "border_lines")
    borders = borders.to_crs("EPSG:4326")
    borders = clip_to_europe_bounds(borders, "border_lines")

    if borders.empty:
        print("Border lines dataset is empty after clipping.")
        raise SystemExit(1)

    # Simplify for web rendering
    borders = borders.copy()
    borders["geometry"] = borders.geometry.simplify(
        tolerance=SIMPLIFY_BORDER_LINES, preserve_topology=True
    )

    # Keep only geometry (lines don't need attributes for rendering)
    borders = borders[["geometry"]].copy()

    print(f"Border lines: {len(borders)} line features.")
    return borders
```

---

#### FEAT-03-C: Update `main()` to Use New Border Lines

**File:** `init_map_data.py`

**Replace the borders processing block (~lines 525-526, 641-645):**

```python
# BEFORE:
borders = fetch_ne_zip(BORDERS_URL, "borders")
borders = clip_to_europe_bounds(borders, "borders")
# ... later ...
borders_combined = clip_to_bounds(borders, hybrid.total_bounds, "borders combined")
borders_combined = borders_combined.copy()
borders_combined["geometry"] = borders_combined.geometry.simplify(
    tolerance=SIMPLIFY_BORDERS, preserve_topology=True
)

# AFTER:
# Fetch polygon countries for spatial joins (cntr_code extraction)
countries_poly = fetch_ne_zip(BORDERS_URL, "borders")
countries_poly = clip_to_europe_bounds(countries_poly, "borders")

# Fetch line-based borders for rendering (no coastlines!)
border_lines = build_border_lines()
borders_combined = border_lines  # Use lines instead of polygon edges
```

**Update the spatial join to use `countries_poly` instead of `borders`:**

In the CNTR_CODE spatial join section (~lines 608-631), change:
```python
# BEFORE:
borders_ll = borders.to_crs("EPSG:4326")

# AFTER:
borders_ll = countries_poly.to_crs("EPSG:4326")
```

---

#### FEAT-03-D: Frontend - Dynamic Stroke Width (Already Implemented)

**File:** `js/app.js`

**Current state at lines 261-266:**
```javascript
if (bordersData) {
    lineCtx.beginPath();
    linePath(bordersData);
    lineCtx.strokeStyle = "#111111";
    lineCtx.lineWidth = 1.6 / k;  // Already dynamic!
    lineCtx.stroke();
}
```

The `lineWidth = 1.6 / k` formula already implements dynamic stroke width. No change needed.

**Optional Enhancement:** Add minimum/maximum clamping for extreme zoom levels:

```javascript
if (bordersData) {
    lineCtx.beginPath();
    linePath(bordersData);
    lineCtx.strokeStyle = "#111111";
    // Clamp between 0.3px (zoomed in) and 2px (zoomed out)
    lineCtx.lineWidth = Math.max(0.3, Math.min(2, 1.2 / k));
    lineCtx.stroke();
}
```

---

#### FEAT-03-E: Acceptance Criteria

| Test | Expected Result |
|------|-----------------|
| Generate data | `europe_countries_combined.geojson` contains LineString/MultiLineString geometries |
| Visual: Norway | Fjord coastlines are NOT drawn as thick borders |
| Visual: Greece | Island coastlines are NOT drawn as thick borders |
| Visual: Germany-France | Land border is clearly visible as a single line |
| Zoom test | Border line width remains visually consistent 0.5-1.5px at all zoom levels |
| File size | `europe_countries_combined.geojson` < 500 KB |

---

## Section 3: Architect's Notes

### Implementation Order

1. **FEAT-03 (Border Lines)** - Implement first. Quick win, improves visual quality immediately.
2. **FEAT-02 (Balkans)** - Implement second. Requires data regeneration.
3. **FEAT-01 (Right Panel)** - Implement last. Frontend-only, no data dependencies.

### Testing Protocol

After implementing all features, run a full regeneration:

```bash
# 1. Clear old data
rm -rf data/*.geojson

# 2. Regenerate
python init_map_data.py

# 3. Verify file sizes
ls -lh data/

# 4. Check for BA/XK
python -c "import json; d=json.load(open('data/europe_final_optimized.geojson')); print(set(f['properties'].get('cntr_code') for f in d['features'] if f['properties'].get('cntr_code') in ['BA','XK']))"

# 5. Visual test in browser
```

### Potential Risks

| Risk | Mitigation |
|------|------------|
| Kosovo ISO code inconsistency | Explicit string matching on "Kosovo" name |
| Border lines file unavailable | Fallback to polygon-based borders with warning |
| Right panel breaks narrow screens | CSS `hidden lg:block` hides on mobile |

### File Size Budget (Updated)

| File | Previous Limit | New Limit | Notes |
|------|----------------|-----------|-------|
| europe_countries_combined.geojson | 1 MB | 500 KB | Lines are smaller than polygons |
| europe_final_optimized.geojson | 5 MB | 5.5 MB | +BA, +XK features |

---

## Appendix: Quick Reference - New/Modified Lines

| File | Lines | Change |
|------|-------|--------|
| init_map_data.py | 62 | Add `BORDER_LINES_URL` |
| init_map_data.py | 64 | Expand `EXTENSION_COUNTRIES` |
| init_map_data.py | 75 | Add `SIMPLIFY_BORDER_LINES` |
| init_map_data.py | ~378 | Add `build_border_lines()` |
| init_map_data.py | ~400 | Add `build_balkan_fallback()` |
| init_map_data.py | 392-395 | Update Admin-1 filter for Balkans |
| init_map_data.py | 525 | Use `countries_poly` for spatial join |
| init_map_data.py | 641 | Use `border_lines` for rendering |
| index.html | 187 | Add `#rightSidebar` HTML block |
| js/app.js | 90 | Add `countryNames` mapping |
| js/app.js | 107 | Add `defaultPalette` backup |
| js/app.js | ~500 | Add `buildCountryList()` function |
| js/app.js | ~540 | Add `applyCountryPaletteToMap()` function |
| js/app.js | 614 | Call `buildCountryList()` after load |

---

**End of Feature Specification**

*Document ID: FEAT-002*
*Classification: Internal Engineering*
*Handoff: Ready for Codex Implementation*
