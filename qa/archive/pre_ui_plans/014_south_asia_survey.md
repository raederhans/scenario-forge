# 014 South Asia Expansion Survey

## Scope

| Country | ISO | Granularity | Source |
|---|---|---|---|
| India | IN | Admin-2 (Districts) | geoBoundaries IND ADM2 |
| Nepal | NP | Admin-1 (Zones/Provinces) | Natural Earth 10m Admin-1 |
| Bhutan | BT | Admin-1 (Districts) | Natural Earth 10m Admin-1 |
| Myanmar | MM | Admin-1 (States/Regions) | Natural Earth 10m Admin-1 |
| Maldives | MV | Admin-0 or Admin-1 (Atolls) | geoBoundaries MDV ADM1 |

Exclusions: Andaman & Nicobar Islands, Lakshadweep (Indian Ocean island territories).

---

## 1. Data Source Analysis

### 1a. India ADM2 (Districts)

**Source**: geoBoundaries gbOpen IND ADM2
- API endpoint: `https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/`
- Direct GeoJSON (same pattern as China): `https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IND/ADM2/geoBoundaries-IND-ADM2.geojson`
- License: CC BY 4.0
- HDX page: https://data.humdata.org/dataset/geoboundaries-admin-boundaries-for-india (17,000+ downloads, last updated May 2024)

**Expected columns** (geoBoundaries standard): `shapeID`, `shapeName`, `shapeISO`, `shapeGroup`, `shapeType`, `geometry`

**Estimated polygon count**: ~740 districts (as of 2024 Census reorganizations). This is the single largest region injection in the pipeline. For comparison: China ADM2 = ~340, France arrondissements = ~330, Russia west ADM2 = ~1800.

**Simplification concern**: At 740 polygons with geoBoundaries full-resolution geometry, vertex count will be high. Strategy:
1. Prefer `simplifiedGeometryGeoJSON` from the API response if available.
2. Apply `simplify(tolerance=0.015, preserve_topology=True)` — slightly more aggressive than China (0.01) because India districts are smaller on average.
3. New config constant: `SIMPLIFY_INDIA = 0.015`

### 1b. Nepal, Bhutan, Myanmar (Admin-1)

**Source**: Natural Earth `ne_10m_admin_1_states_provinces` (already downloaded via `ADMIN1_URL`).

| Country | ISO | Expected Admin-1 count | Notes |
|---|---|---|---|
| Nepal | NP | ~7 provinces | Well-covered in NE 10m |
| Bhutan | BT | ~20 districts | Well-covered in NE 10m |
| Myanmar | MM | ~15 states/regions | Well-covered in NE 10m |

**Action**: Add `"NP", "BT", "MM"` to `EXTENSION_COUNTRIES` and add name fallbacks `"Nepal", "Bhutan", "Myanmar"` to `build_extension_admin1()`.

### 1c. Maldives (MV)

**Problem**: Natural Earth 10m Admin-1 explicitly notes that "tiny island nations" may lack Admin-1 subdivisions. The Maldives (99% ocean, ~300 km² total land) is almost certainly absent or reduced to a single point/polygon in NE Admin-1.

**Solution**: Use geoBoundaries MDV ADM1 (confirmed available on HDX with ADM0, ADM1, ADM2 levels).
- API endpoint: `https://www.geoboundaries.org/api/current/gbOpen/MDV/ADM1/`
- Direct GeoJSON: `https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/MDV/ADM1/geoBoundaries-MDV-ADM1.geojson`
- Expected: ~20 administrative atolls

**Alternative**: Use ADM0 (single country polygon) if ADM1 atolls are too fragmented for the map scale. Recommend trying ADM1 first and falling back to ADM0 if rendering is poor.

**Important**: Maldives atolls are tiny. The `smart_island_cull` threshold of 1000 km² would delete every single Maldives feature. This requires explicit handling (see Section 3).

---

## 2. Bounding Box

Current bounds: `EUROPE_BOUNDS = (-25.0, 10.0, 180.0, 83.0)`

South Asia latitudes:
- India southernmost (Kanyakumari): ~8.1°N
- Maldives southernmost: ~-0.7°S (crosses equator)
- Myanmar southernmost: ~9.8°N
- Nepal/Bhutan: ~26–28°N (no issue)

**Required update**: Lower `ymin` from `10.0` to **-2.0** to capture all Maldives atolls.

```python
EUROPE_BOUNDS = (-25.0, -2.0, 180.0, 83.0)
```

**Impact**: This pulls in equatorial ocean/land background for the Indian Ocean. Political regions are ISO-filtered so no unwanted countries appear. Background layer vertex count increases moderately.

---

## 3. Island Filtering Strategy

### Problem
`smart_island_cull(threshold_km2=1000.0)` runs globally on the hybrid layer. It would:
- **Correctly remove** Andaman & Nicobar Islands (~8,250 km² total but individual islands < 1000 km²)
- **Incorrectly remove** all Maldives features (largest atoll ~30 km²)
- **Correctly remove** Lakshadweep (~32 km²) — desired exclusion

### Proposed Solution: VIP Points + Exclusion Box

**Step A — Exclude Andaman/Nicobar and Lakshadweep from India**:
After loading India ADM2, filter by bounding box before merging:
```python
# Pseudocode: remove Indian territories east of 90°E and south of 15°N
# (Andaman & Nicobar are at ~92°E, 6–14°N)
# Also remove Lakshadweep (~72°E, 8–12°N, area < 100 km²)
in_gdf = in_gdf[~(
    (in_gdf.geometry.representative_point().x > 88.0) &
    (in_gdf.geometry.representative_point().y < 15.0)
)]
# Lakshadweep: filter by name or by tiny area
in_gdf = in_gdf[~in_gdf["name"].str.contains("Lakshadweep|Laccadive", case=False, na=False)]
```

**Step B — Whitelist Maldives in VIP_POINTS**:
Add a VIP point inside the Maldives to prevent `smart_island_cull` from removing it:
```python
VIP_POINTS = [
    ...existing...,
    ("Maldives", (73.5, 4.17)),  # Malé atoll
]
```

**Step C — Lower island cull threshold for South Asia** (alternative):
Instead of global 1000 km², pass a lower threshold when processing Maldives features. However, this complicates the global cull. The VIP approach (Step B) is simpler.

**Recommended flow**:
1. Load India ADM2 → filter out Andaman/Nicobar/Lakshadweep by coordinates and name
2. Load Maldives ADM1 separately via geoBoundaries
3. Add Maldives VIP point to config
4. `smart_island_cull` preserves Maldives via VIP whitelist

---

## 4. China Border Clipping

India and China share a disputed border (Aksai Chin, Arunachal Pradesh). Both geoBoundaries datasets may overlap in these areas.

**Strategy (simple, per requirements)**:
- Load China first (already in pipeline via `apply_china_replacement`)
- Load India second
- Clip India geometry against existing China geometry using `gpd.overlay(how="difference")`
- This gives China priority in disputed zones

```python
# Pseudocode
cn_union = existing_hybrid[existing_hybrid["cntr_code"] == "CN"].unary_union
in_gdf["geometry"] = in_gdf.geometry.difference(cn_union)
```

**Performance note**: `unary_union` on ~340 China polygons is moderately expensive. Consider caching the union or using a spatial index. Acceptable for a one-time build step.

---

## 5. Architecture

### Option A: Single `processors/south_asia.py`
Contains `apply_south_asia_replacement(main_gdf)` that handles IN, MV, and adds NP/BT/MM to extension countries.

### Option B: Separate files
- `processors/india.py` — India ADM2 + island filtering + China clipping
- Maldives handled inside India processor or as a small addition

### Recommendation: **Option A** — single `processors/south_asia.py`

Rationale:
- India and Maldives are tightly coupled (island filtering logic, shared ocean region)
- NP/BT/MM are simple `EXTENSION_COUNTRIES` additions (no custom processor needed)
- Keeps processor count manageable
- Follows the pattern of `russia_ukraine.py` (multiple related countries in one file)

### Pipeline order in `main()`:
```python
hybrid = apply_holistic_replacements(hybrid)      # France
hybrid = apply_russia_ukraine_replacement(hybrid)  # RU/UA
hybrid = apply_poland_replacement(hybrid)           # Poland
hybrid = apply_china_replacement(hybrid)            # China  ← must run before India
hybrid = apply_south_asia_replacement(hybrid)       # India + Maldives (clips against CN)
```

---

## 6. Complexity Estimate

| Item | Count | Vertex Impact |
|---|---|---|
| India ADM2 districts | ~740 | High — needs tolerance 0.015+ |
| Maldives ADM1 atolls | ~20 | Low — tiny polygons |
| Nepal Admin-1 | ~7 | Negligible |
| Bhutan Admin-1 | ~20 | Negligible |
| Myanmar Admin-1 | ~15 | Low |
| **Total new regions** | **~800** | |

**Current estimated total regions** (pre-South Asia): ~4,500–5,000
**Post-South Asia**: ~5,300–5,800

**Performance mitigation**:
- `SIMPLIFY_INDIA = 0.015` (aggressive for district-level)
- Exclude Andaman/Nicobar/Lakshadweep (~35 fewer polygons)
- Maldives VIP point prevents accidental culling
- Monitor TopoJSON output size; if > 30 MB, increase India tolerance to 0.02

---

## 7. Config Changes Summary

```python
# New URLs
IND_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2.geojson"
)
IND_ADM2_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2.geojson",
]
MDV_ADM1_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/MDV/ADM1/"
    "geoBoundaries-MDV-ADM1.geojson"
)
MDV_ADM1_FALLBACK_URLS = [
    "https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/MDV/ADM1/"
    "geoBoundaries-MDV-ADM1.geojson",
]
IND_ADM2_FILENAME = "geoBoundaries-IND-ADM2.geojson"
MDV_ADM1_FILENAME = "geoBoundaries-MDV-ADM1.geojson"

# Simplification
SIMPLIFY_INDIA = 0.015

# Extension countries: add NP, BT, MM (NOT IN or MV — handled by processor)
EXTENSION_COUNTRIES = { ...existing..., "NP", "BT", "MM" }

# Bounds
EUROPE_BOUNDS = (-25.0, -2.0, 180.0, 83.0)

# VIP points
VIP_POINTS = [ ...existing..., ("Maldives", (73.5, 4.17)) ]
```

---

## 8. Execution Checklist

1. Update `config.py`: bounds, URLs, filenames, tolerances, extension countries, VIP points
2. Create `processors/south_asia.py` with `apply_south_asia_replacement()`
3. Update `admin1.py`: add `"Nepal", "Bhutan", "Myanmar"` to name fallback filter
4. Update `init_map_data.py`: import and call `apply_south_asia_replacement` after China
5. Run `python init_map_data.py` — verify output
6. Run `python tools/translate_manager.py` — update locale names
7. Update `js/app.js`: add IN/NP/BT/MM/MV to `countryNames` and `countryPalette`
8. Visual QA: check India/Maldives rendering, confirm no Andaman/Nicobar, confirm China border clean
