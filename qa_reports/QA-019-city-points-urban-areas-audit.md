# QA-019: City Points & Urban Areas Comprehensive Audit

**Date**: 2026-03-18
**Scope**: City point rendering, UI controls, backend pipeline, city-urban relationship
**Files Audited**: 12 primary files across JS/Python/HTML/JSON layers

---

## Table of Contents

1. [Architecture Summary](#1-architecture-summary)
2. [Data Pipeline Audit](#2-data-pipeline-audit)
3. [Rendering Audit](#3-rendering-audit)
4. [UI/UX Audit](#4-uiux-audit)
5. [City-Urban Relationship Audit](#5-city-urban-relationship-audit)
6. [Bug & Issue Catalog](#6-bug--issue-catalog)
7. [Improvement Proposals](#7-improvement-proposals)
8. [City-Urban Integration Vision](#8-city-urban-integration-vision)

---

## 1. Architecture Summary

### City Points System

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA SOURCES                                                       │
│  GeoNames (cities15000) + Natural Earth → merge_world_cities()      │
│  → world_cities.geojson (21,338 points)                             │
│  → city_aliases.json (189,269 aliases)                              │
│  → per-scenario: city_overrides.json + capital_hints.json           │
├─────────────────────────────────────────────────────────────────────┤
│  NORMALIZATION (data_loader.js)                                     │
│  normalizeCityFeature() → __city_* prefixed internal properties     │
│  normalizeCityFeatureCollection() → typed FeatureCollection         │
├─────────────────────────────────────────────────────────────────────┤
│  COMPOSITION (map_renderer.js: getEffectiveCityCollection)          │
│  world base → scenario overrides → capital resolution → merged FC   │
├─────────────────────────────────────────────────────────────────────┤
│  REVEAL PLAN (buildCityRevealPlan)                                  │
│  viewport cull → country quotas → tier sort → budget allocation     │
│  6 phases: P0 (18 markers) → P5 (170 markers, 48 labels)           │
├─────────────────────────────────────────────────────────────────────┤
│  RENDERING (drawCityPointsLayer)                                    │
│  sprite cache → canvas drawImage() → label overlap rejection        │
│  3D disc + crown (capitals) | theme: classic_graphite               │
├─────────────────────────────────────────────────────────────────────┤
│  INTERACTION                                                        │
│  hover via visibleCityHoverEntries → tooltip (name, capital, tag)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Urban Areas System

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA: Natural Earth 10m → europe_urban.geojson (Polygon/MultiPoly) │
│  Properties: scalerank, area_sqkm, min_zoom                        │
│  IDs: assign_stable_urban_area_ids() → UA_{SHA1[:12]}              │
├─────────────────────────────────────────────────────────────────────┤
│  RENDERING (drawUrbanLayer): Canvas fill, multiply blend, 0.4α     │
│  Culling: minAreaPx threshold (default 8px) + viewport bounds      │
├─────────────────────────────────────────────────────────────────────┤
│  CITY LIGHTS (drawModernCityLightsCores)                            │
│  Urban polygons → centroid → NASA luminance grid sample             │
│  → halo + core + glint ellipses (screen blend in night hemisphere)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Pipeline Audit

### 2.1 City Data (`map_builder/cities.py`)

| Area | Finding | Severity |
|------|---------|----------|
| **Sources** | Dual-source merge (GeoNames + Natural Earth) is robust, deduplication works via coordinates + name matching | OK |
| **Tier classification** | Major ≥1.5M or capital; Regional ≥350K or admin capital; Minor: rest — reasonable thresholds | OK |
| **Min zoom defaults** | country_capital=0.8, regional=1.6, minor=2.9 — sensible for 6-phase reveal | OK |
| **Alias limit** | `ALIAS_LIMIT = 24` per city — adequate for most cases | OK |
| **Political attachment** | Two-stage: within → nearest (max distance per config). Country-first fallback is smart | OK |
| **Urban attachment** | Two-stage: within → nearest (50km max). Selects smallest containing polygon | OK |
| **City filtering** | Geonames-only cities without urban match, capital status, or 120K population are DROPPED | **INFO** |
| **Stable keys** | Format `id::CITY::ne::XXXXX` or `id::CITY::gn::XXXXX` — provides source-stable identity | OK |

**Issue P-001**: The city filtering logic (line 942-950) means some legitimate cities may be silently dropped if they come from GeoNames, are not capitals, have population <120K, and have no urban area match. This creates a hidden dependency between the urban dataset extent and which cities appear on the map.

**Issue P-002**: `assign_stable_urban_area_ids()` uses WKB geometry hash. Simplification changes to urban geometries will alter IDs, breaking any cached city→urban linkage. This is fragile for incremental updates.

### 2.2 Scenario City Overrides

| Scenario | Overrides | Capital Hints | Notes |
|----------|-----------|---------------|-------|
| blank_base | ✓ | ✓ | Minimal baseline |
| hoi4_1936 | ✓ | ~121 hints | Extensive tag→capital mapping |
| hoi4_1939 | ✓ | ✓ | Subset of 1936 with adjustments |
| modern_world | ✓ | ✓ | Matches contemporary sovereignty |
| tno_1962 | ✓ | ✓ | Includes city renames (e.g., St. Petersburg → Leningrad) + manual capitals |

**Issue P-003**: The `SCENARIO_MANUAL_CAPITALS` dict in `cities.py` is hardcoded for `tno_1962` only. Other scenarios rely entirely on data-driven capital hints. If a scenario needs a manual override, the only path is editing Python source — no config file mechanism exists for this.

### 2.3 Localization

- City names support `en`/`zh` bilingual labels via `getCityLocaleEntry()`
- Display name override (from scenario) takes priority via `__city_display_name_override`
- Alias-based lookup enables fuzzy matching via `city_aliases.json`

**Issue P-004**: The locale fallback chain (`display_name_override → locale entry → name_en → name → id`) is complex (5+ levels). When `name_zh` is empty string `""`, it passes the `||` chain but renders blank. Should explicitly check for non-empty trimmed string.

---

## 3. Rendering Audit

### 3.1 Rendering Pipeline Position

```
drawContextBasePass:
  1. drawPhysicalLayer (atlas + contour)
  2. drawUrbanLayer          ← Urban areas (canvas, multiply blend)
  3. drawRiversLayer
  4. drawCityPointsLayer     ← City points (canvas, source-over)
```

**Issue R-001**: City points are drawn AFTER urban areas, which is correct for z-order (points on top of polygons). However, there is NO visual coordination between them — a city point that sits on an urban area polygon has no visual differentiation from one in rural territory.

### 3.2 City Marker Sprites

**Sprite system**: `getCityMarkerSprite()` → `renderCityMarkerSprite()`

- 3D disc with gradient (top→mid→bottom), rim darkening, specular highlight
- Capital overlay: elliptical crown ring + 3-point crown spikes above disc
- Theme: `classic_graphite` — only one theme available despite `<select>` element
- Sprite cache keyed by: `theme|tier|capital|sizePx|color|capitalColor`

| Aspect | Finding | Severity |
|--------|---------|----------|
| Sprite quality | High-quality 3D disc with proper lighting model | OK |
| Cache invalidation | Based on 6-part key — correct and thorough | OK |
| OffscreenCanvas fallback | Falls back to `document.createElement("canvas")` | OK |
| **Size scaling** | `drawWidth = sprite.width / scale` — divides by zoom scale, meaning sprites get SMALLER as you zoom in | **BUG** |

**Issue R-002**: The sprite rendering uses `context.drawImage(sprite.canvas, drawX, drawY, drawWidth, drawHeight)` where `drawWidth = sprite.width / scale` and `drawHeight = sprite.height / scale`. Because `context` is already in the zoom transform coordinate space, dividing by `scale` compensates for the zoom — this keeps markers at constant screen size. However, this means city markers do NOT grow as you zoom in, which is counterintuitive for a map. At P5 (scale 3.05+) with 170 visible markers, they remain the same screen size as at P0 (scale 1.0) with 18 markers, leading to visual density issues at high zoom.

### 3.3 City Reveal Plan

The 6-phase budget system is well-designed:

```
P0: scale 0.00–1.15  → 18 markers,  0 labels  (country capitals only for tier-A countries)
P1: scale 1.15–1.45  → 28 markers,  0 labels
P2: scale 1.45–1.90  → 42 markers,  0 labels
P3: scale 1.90–2.45  → 72 markers,  0 labels
P4: scale 2.45–3.05  → 110 markers, 24 labels  (labels begin appearing)
P5: scale 3.05+       → 170 markers, 48 labels
```

**Issue R-003**: Labels only appear at P4+ (scale ≥ 2.45). Below that zoom, even capitals show only as dots with no text identification. For a map tool, users need to identify cities at lower zoom levels. The capital names at minimum should be labelable at P2-P3.

**Issue R-004**: The country-based quota system (`getCityMarkerQuotaForTier`) is good for balance but can cause frustration: if a large country (Tier A) fills its quota, important regional capitals near the current viewport center may be hidden while distant minor cities in small countries (Tier E) are shown, because they haven't hit their quota.

### 3.4 Label Rendering

| Aspect | Finding | Severity |
|--------|---------|----------|
| Overlap rejection | `doScreenBoxesOverlap()` — axis-aligned bounding boxes, O(n²) scan | OK for ≤64 |
| Label placement | Always RIGHT of marker (`labelX = anchor + offsetPx/scale`) | **LIMITATION** |
| Label truncation | `formatCityMapLabel()` → clean → abbreviate → truncate to fit | OK |
| Font | Libre Baskerville serif stack, weight 600 for capitals, 400 for regular | OK |
| Shadow | Theme-based shadow with blur and offset for readability | OK |

**Issue R-005**: Labels are ALWAYS placed to the right of the marker. No multi-direction placement is attempted (left, above, below). When two nearby cities both need right-side labels, the second one will be dropped by overlap rejection instead of trying an alternative position. This is particularly bad along coastlines where cities cluster linearly.

**Issue R-006**: The overlap detection uses screen-space bounding boxes, but the label font size is computed in projection space (`fontPx / scale`), then the bounding box width is measured with `measureText()` and multiplied by `scale`. This double-conversion can cause subtle off-by-one issues at non-integer scales.

### 3.5 Hover & Tooltip

- `cacheVisibleCityHoverEntries()` stores all rendered markers for hit testing
- `getHoveredCityEntryFromEvent()` does distance-based nearest-neighbor search
- Tooltip shows: display name, capital descriptor, country name (code)

**Issue R-007**: Hit testing iterates ALL visible entries linearly (`O(n)` per mouse move). At P5 with 170 entries this is fine, but if budgets increase, a spatial index (grid or quadtree) would be needed.

### 3.6 City Lights Integration

The night lights system uses urban polygon centroids as light core positions, with NASA Black Marble luminance data for intensity modulation. This is the ONLY place where city and urban data interact at render time.

**Issue R-008**: `drawModernCityLightsCores()` iterates `state.urbanData.features` directly — it does NOT use city point data at all. This means city lights are driven entirely by urban area polygons. Cities without a matching urban area (rural capitals, small towns) will never produce night lights, even if they should logically emit some light.

---

## 4. UI/UX Audit

### 4.1 City Points Panel (index.html lines 482-558)

```
City Points [toggle]
├── Style Preset: [Classic Graphite] (only option)
├── Marker Scale: [0.75 ─── 1.00 ─── 1.40]
├── Label Density: [Sparse | Balanced | Dense]
├── Point Opacity: [0% ─── 94% ─── 100%]
├── Show City Labels [toggle]
├── Highlight Capitals [toggle]
└── Advanced ▸
    ├── Point Color: [#2f343a]
    ├── Capital Highlight Color: [#9f9072]
    ├── Point Size: [1.0 ─── 3.2 ─── 8.0]
    └── Label Size: [8px ─── 11px ─── 24px]
```

### 4.2 Urban Areas Panel

```
Urban Areas [toggle]
├── Color: [#4b5563]
├── Opacity: [0% ─── 40% ─── 100%]
├── Blend Mode: [Multiply | Normal | Overlay]
└── Min Area (px): [0 ─── 8 ─── 80]
```

### 4.3 UI Issues

| ID | Issue | Severity |
|----|-------|----------|
| **U-001** | Style Preset dropdown has only ONE option ("Classic Graphite"). Creates false expectation that more themes exist. Either add themes or remove the dropdown and display as static text | Low |
| **U-002** | City Points panel and Urban Areas panel are in separate `<details>` sections with no visual link between them, despite being semantically related geographic layers | Low |
| **U-003** | No search/filter for cities — users cannot find a specific city from the UI without zooming and scanning | Medium |
| **U-004** | No way to toggle capital-only display vs. all cities. The "Highlight Capitals" checkbox only controls the crown overlay, not filtering | Low |
| **U-005** | Label Density hint text ("Controls how many labels can appear per viewport at mid/high zoom") is the only hint in the panel — inconsistent with other controls that lack hints | Low |
| **U-006** | Point Size slider (1.0–8.0) in Advanced section overlaps functionally with Marker Scale (0.75–1.40). Two separate size controls creates confusion — their interaction is multiplicative but this isn't communicated | Medium |
| **U-007** | No population filter or tier filter — users cannot show only "major" cities | Low |
| **U-008** | Urban Areas lacks a "Show Labels" toggle or any textual identification — urban areas are anonymous fill polygons | Low |
| **U-009** | No link between day/night City Lights controls (separate panel) and the City Points / Urban Areas panels, though they are functionally dependent | Medium |

---

## 5. City-Urban Relationship Audit

### 5.1 Current State

The city-urban relationship has **three layers** of connection, each at a different system tier:

| Layer | Where | What | Used? |
|-------|-------|------|-------|
| **Build-time** | `cities.py:_attach_cities_to_urban()` | Each city gets `urban_area_id` + `urban_match_method` ("within"/"nearest"/empty) | ✓ Data generated |
| **Load-time** | `data_loader.js:normalizeCityFeature()` | Stored as `__city_urban_match_id` on each city feature | ✓ Property stored |
| **Render-time** | `map_renderer.js` | **NOT USED** — renderer never reads `__city_urban_match_id` | ✗ DEAD DATA |

**CRITICAL FINDING**: The `__city_urban_match_id` property is computed in the Python pipeline, preserved through JavaScript normalization, but **never consumed** by any rendering, interaction, or UI code. It is dead data at the frontend — a half-built bridge.

### 5.2 Night Lights: Implicit Connection

The only runtime connection between cities and urban areas is **implicit** via the night lights system:
- `drawModernCityLightsCores()` uses urban polygon centroids
- `drawModernCityLightsTexture()` uses NASA grid data
- Neither function references city point data

This means the night lights are essentially an "urban areas with NASA luminance" layer, not a "city lights" layer.

### 5.3 Rendering Order Disconnect

```
Layer order: ... → Urban polygons → Rivers → City points
```

Urban areas and city points are drawn as completely independent layers. There is no:
- Visual scaling of city markers based on their urban area size
- Opacity or color modulation of urban areas based on contained city population
- Shared hover/tooltip linking city name to urban area extent
- Visual connector (e.g., subtle ring) showing city-urban containment

---

## 6. Bug & Issue Catalog

### Critical

| ID | Description | File:Line | Impact |
|----|-------------|-----------|--------|
| **BUG-001** | `__city_urban_match_id` is dead data — computed but never used in renderer | data_loader.js:193, map_renderer.js | Wasted computation, missed visual feature |

### High

| ID | Description | File:Line | Impact |
|----|-------------|-----------|--------|
| **R-005** | Labels only placed to right of marker — no multi-direction fallback | map_renderer.js:7561 | Label density severely limited on coastlines/clusters |
| **R-003** | No labels below scale 2.45 — capitals unnamed at continental zoom | map_renderer.js:260-267 | Users can't identify cities until deep zoom |
| **P-001** | City filtering silently drops GeoNames cities without urban match | cities.py:942-950 | Potentially missing small but important cities |

### Medium

| ID | Description | File:Line | Impact |
|----|-------------|-----------|--------|
| **R-002** | Markers stay constant screen-size at all zoom levels | map_renderer.js:7507-7511 | No visual progression as user zooms in |
| **R-004** | Country quota can hide viewport-central cities for distant ones | map_renderer.js:7033-7044 | Frustrating when exploring specific regions |
| **R-008** | Night lights ignore city points, only use urban polygons | map_renderer.js:7936-7937 | Rural capitals have no night lights |
| **U-006** | Two overlapping size controls (Marker Scale + Point Size) | index.html:500-503, 541-545 | Confusing for users |
| **U-009** | City Lights panel disconnected from City Points / Urban panels | index.html | Users don't understand the dependency |
| **P-004** | Empty `name_zh` passes fallback chain, renders blank | data_loader.js:155-158 | Blank labels for untranslated cities |

### Low

| ID | Description | File:Line | Impact |
|----|-------------|-----------|--------|
| **U-001** | Single-option theme dropdown | index.html:494-496 | Misleading UI |
| **U-003** | No city search/filter UI | index.html | Usability gap |
| **U-008** | Urban areas have no text identification | – | Anonymous polygons |
| **P-002** | Urban IDs based on WKB hash — fragile across simplification | cities.py:732 | Maintenance risk |
| **P-003** | Manual capital overrides hardcoded for tno_1962 only | cities.py | Scaling limitation |
| **R-006** | Label bounding box double-conversion at non-integer scales | map_renderer.js:7541-7546 | Subtle label overlap glitches |

---

## 7. Improvement Proposals

### 7.1 Short-Term (Low-risk, high-value)

#### PROP-001: Enable Capital Labels at Lower Zoom

**Problem**: Capital cities are nameless dots until scale 2.45 (P4).
**Fix**: Add a `capitalLabelMinZoom` override to the reveal phases. At P2-P3, allow labels for `isCapital && isCountryCapital` entries, with a small budget (8-12 labels).

```javascript
// In CITY_REVEAL_PHASES, add capitalLabelBudget:
{ id: "P2", minScale: 1.45, maxScale: 1.9, markerBudget: 42, labelBudget: 0, capitalLabelBudget: 8 },
{ id: "P3", minScale: 1.9, maxScale: 2.45, markerBudget: 72, labelBudget: 0, capitalLabelBudget: 12 },
```

#### PROP-002: Multi-Direction Label Placement

**Problem**: Labels only go right, causing heavy rejection on linear clusters.
**Fix**: Try 4 positions (right → above → left → below) before rejecting. Cost: ~4x `measureText()` calls per entry, but only for the subset that would otherwise be rejected.

```javascript
const LABEL_OFFSETS = [
  { dx: 1, dy: 0, align: "left", baseline: "middle" },     // right
  { dx: 0, dy: -1, align: "center", baseline: "bottom" },   // above
  { dx: -1, dy: 0, align: "right", baseline: "middle" },    // left
  { dx: 0, dy: 1, align: "center", baseline: "top" },       // below
];
```

#### PROP-003: Consolidate Size Controls

**Problem**: "Marker Scale" and "Point Size" in Advanced are confusingly multiplicative.
**Fix**: Remove the Advanced "Point Size" slider. The "Marker Scale" slider already provides sufficient control. Alternatively, rename "Point Size" to "Base Size (Advanced)" and add a hint explaining the interaction.

#### PROP-004: Fix Empty `name_zh` Fallback

**Problem**: Empty string `""` passes `||` chain.
**Fix**: In `getCityDisplayLabel()` chain, replace `||` with explicit non-empty-trim check.

### 7.2 Medium-Term (Moderate effort)

#### PROP-005: City-Urban Visual Linkage (see Section 8)

Activate `__city_urban_match_id` to create visual coordination between city points and urban area polygons.

#### PROP-006: City Search

Add a search input to the City Points panel that:
1. Queries `city_aliases.json` for fuzzy matching
2. Pans and zooms to the selected city
3. Highlights the city marker with a pulse animation

#### PROP-007: Tier/Population Filter

Add a dropdown or multi-select to the City Points panel:
- Show: All / Major only / Major + Regional / Capitals only
- This modifies the reveal plan's candidate filter, not just the budget

#### PROP-008: Night Lights for Non-Urban Cities

For cities with `__city_urban_match_id === ""` that are capitals or major tier, inject synthetic light cores at the city point coordinates in `drawModernCityLightsCores()`.

### 7.3 Long-Term (Architectural)

#### PROP-009: Unified Settlement Layer

Merge urban areas and city points into a single "settlements" layer concept with two visual modes:
- **Extent mode** (current urban polygons) — shows built-up area footprint
- **Point mode** (current city markers) — shows city center with label
- Unified controls: one panel, coordinated zoom behavior

#### PROP-010: Additional City Marker Themes

The theme system (`CITY_MARKER_THEME_TOKENS`) is already parameterized but only has one theme. Add:
- `modern_clean` — flat design, no 3D disc
- `historical_parchment` — sepia tones matching paper texture
- `satellite_night` — bright dots matching city lights aesthetic

---

## 8. City-Urban Integration Vision

### Design Principles

Cities and urban areas represent the same phenomenon at different scales and abstraction levels:
- **Urban areas** = physical extent of built-up territory (polygon, areal)
- **City points** = symbolic representation of a settlement (point, nominal)

They should work together while maintaining distinct visual identities:

| Zoom Level | Urban Areas | City Points | Interaction |
|------------|-------------|-------------|-------------|
| Continental (P0-P1) | Hidden or very faint | Major capitals only, small markers | Independent — urban areas too small to see |
| Regional (P2-P3) | Visible as dark patches | 42-72 markers, no labels | Urban areas provide context for marker clusters |
| Detail (P4-P5) | Full rendering | 110-170 markers with labels | Active coordination: urban extent → marker emphasis |

### Proposed Integration Features

#### A. Urban-Aware City Prominence

Use `__city_urban_match_id` to boost marker size for cities within large urban areas:

```javascript
function getUrbanAwareMarkerScale(entry) {
  const urbanId = entry.feature?.properties?.__city_urban_match_id;
  if (!urbanId) return 1.0;
  const urbanFeature = state.urbanIndex?.get(urbanId);
  if (!urbanFeature) return 1.0;
  const areaSqKm = Number(urbanFeature.properties?.area_sqkm || 0);
  // Mega-cities (>1000 km²) get 20% boost, large cities (>200 km²) get 10%
  return areaSqKm > 1000 ? 1.20 : areaSqKm > 200 ? 1.10 : 1.0;
}
```

#### B. Urban Area Hover Cross-Link

When hovering a city point that has `__city_urban_match_id`, subtly highlight the corresponding urban area polygon (e.g., brighten opacity by 20%). And vice versa: hovering an urban area polygon shows the names of cities contained within it.

#### C. Urban-Informed Label Priority

Cities with urban area match should get label priority over equally-sized cities without urban areas, because the urban polygon provides visual context that makes the label more informative.

#### D. Coordinated Visibility Transitions

At the zoom level where urban areas first become visible, fade in the corresponding city point simultaneously — creating a coherent "settlement appearing" visual event rather than two independent layer animations.

#### E. Night Lights Enrichment

Extend `drawModernCityLightsCores()` to also process city points that lack urban area matches but qualify by tier/capital status. This fills the "dark capital" gap (Issue R-008).

### Implementation Priority

```
Phase 1 (Quick wins):
  ├── PROP-001: Capital labels at P2-P3
  ├── PROP-004: Fix empty name_zh fallback
  └── PROP-003: Consolidate size controls

Phase 2 (Core integration):
  ├── PROP-005A: Build state.urbanIndex Map<urbanId, feature>
  ├── PROP-005B: Urban-aware marker scaling
  ├── PROP-008: Night lights for non-urban cities
  └── PROP-002: Multi-direction label placement

Phase 3 (UX enrichment):
  ├── PROP-005C: Cross-link hover highlighting
  ├── PROP-006: City search
  └── PROP-007: Tier/population filter

Phase 4 (Architecture):
  ├── PROP-009: Unified settlement layer concept
  └── PROP-010: Additional marker themes
```

---

## Appendix A: Key File References

| File | Role | Key Lines |
|------|------|-----------|
| `map_builder/cities.py` | City data generation | 719-739 (urban IDs), 883-931 (urban attachment), 934-950 (world build) |
| `js/core/data_loader.js` | Feature normalization | 130-203 (normalizeCityFeature), 163-164 (urban match ID) |
| `js/core/map_renderer.js` | Rendering engine | 6177-6212 (urban layer), 6849-6937 (sprite render), 6984-7064 (reveal plan), 7162-7295 (effective collection), 7454-7576 (draw city points), 7936-8027 (city lights cores) |
| `js/core/state.js` | State config | cityPoints config block, showCityPoints, worldCitiesData |
| `js/ui/toolbar.js` | UI event handlers | syncCityPointsConfig, city control bindings |
| `js/ui/i18n.js` | Label localization | resolveGeoLocaleText, getPreferredGeoLabel, getCityLocaleEntry |
| `index.html` | UI markup | 482-558 (city panel), 443-478 (urban panel) |

## Appendix B: Constants Reference

```javascript
// Marker sizes (pixels)
CITY_MARKER_BASE_SIZES_PX = { minor: 5.8, regional: 7.7, major: 10.4 }
CITY_MARKER_SIZE_LIMITS_PX = { minor: 10, regional: 14, major: 18, capital: 22 }

// Reveal phases
P0: 18 markers, 0 labels  (scale < 1.15)
P1: 28 markers, 0 labels  (scale 1.15-1.45)
P2: 42 markers, 0 labels  (scale 1.45-1.90)
P3: 72 markers, 0 labels  (scale 1.90-2.45)
P4: 110 markers, 24 labels (scale 2.45-3.05)
P5: 170 markers, 48 labels (scale 3.05+)

// Label density budgets
sparse:   { P4: 16, P5: 32 }
balanced: { P4: 24, P5: 48 }
dense:    { P4: 32, P5: 64 }

// Urban defaults
color: "#4b5563", opacity: 0.4, blendMode: "multiply", minAreaPx: 8

// City defaults
theme: "classic_graphite", opacity: 0.94, labelDensity: "balanced"
color: "#2f343a", capitalColor: "#9f9072"
```
