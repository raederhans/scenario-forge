# QA-055: CZ/SK Refinement Visibility, Reichskommissariat UX & Boundary Audit

**Date**: 2026-03-05
**Severity**: Mixed (High / Medium / High)
**Scope**: Detail topology rendering, scenario preset UX, releasable boundary accuracy
**Related**: QA-054

---

## Issue 1: CZ/SK ADM2 Features Not Visible Across All Scenarios

### Updated Diagnosis (post QA-054)

Since the user CAN now see China-Japan (CN_CITY) changes, **composite topology mode IS working**. The detail topology (na_v2.json, 11,196 features) is loaded and composed with the primary topology (199 features). This rules out QA-054's hypothesis about composite mode failure.

### Data Integrity Verified

| Check | Result |
|---|---|
| CZ_ADM2 features in na_v2.json | 18 features, valid Polygon/MultiPolygon geometry (50-142 pts each) |
| SK_ADM2 features in na_v2.json | 12 features, valid geometry |
| CZ_ADM2 `properties.id` present | Yes, e.g., `CZ_ADM2_57006924B74936445485800` |
| CZ_ADM2 `cntr_code` | `CZ` (correct) |
| 1939 ownership: CZ_ADM2 | All 18 assigned to `GER` |
| 1939 ownership: CZ NUTS | 13 assigned to `BOM`, 1 (CZ080) to `POL` |
| 1936 ownership: CZ_ADM2 | All 18 assigned to `CZE` |
| 1936 ownership: CZ NUTS | All 14 assigned to `CZE` |
| Shared arcs CZ/CZ_ADM2 (na_v2) | **138 shared arcs** - borders WILL be drawn |
| Shared arcs CZ/CZ_ADM2 (runtime_political) | **151 shared arcs** - borders WILL be drawn |
| Computed neighbors | CZ_ADM2 features correctly neighbor CZ NUTS features |

### Root Cause Analysis

The data pipeline is **technically correct**. The CZ_ADM2/SK_ADM2 features exist, have valid geometry, are in the detail topology, share arcs with neighboring features, and have correct ownership assignments. The rendering pipeline should display them.

**Three factors combine to make the refinement invisible to the user:**

#### Factor 1: Color Similarity (1939 scenario)

| Entity | Color | Visual |
|---|---|---|
| GER (Germany) | `#666057` | Dark cool gray |
| BOM (Bohemia-Moravia) | `#6a4b3a` | Dark warm brown |

These two colors have low contrast. On screen at typical map zoom levels, the Sudetenland districts (GER gray) painted over the protectorate regions (BOM brown) are difficult to distinguish, especially for the small CZ_ADM2 features.

**RGB delta**: GER(102,96,87) vs BOM(106,75,58) = delta(4,21,29). The luminance difference is only ~7%.

#### Factor 2: Same-Color in 1936 and Default View (By Design)

In the 1936 scenario and default view, CZ_ADM2 features are assigned to `CZE` (Czechoslovakia) — the same owner as the CZ NUTS features. Therefore:
- Same color applied to both
- No dynamic border drawn (same owner on both sides)
- **The refinement is architecturally invisible** in 1936 and default views

This is **by design** — Sudetenland was still part of Czechoslovakia in 1936. The refinement only becomes visually meaningful in 1939 when different owners are assigned. The user expectation of seeing "refined tiles" in all scenarios is a UX gap, not a data bug.

#### Factor 3: Geometry Overlap (CZ NUTS not clipped)

The CZ NUTS features in na_v2 (CZ010, CZ020, etc.) still retain their **full original geometry** including the areas covered by CZ_ADM2 features. The `cz_sk_border_detail.py` processor has clipping code (`_subtract_target_union`, `_clip_source_to_shell`), but the resulting topology shows that CZ NUTS features still share arcs with CZ_ADM2 features — they overlap geometrically.

In canvas rendering:
1. CZ NUTS features are painted first (earlier in the feature array, indices ~5000-5014)
2. CZ_ADM2 features are painted later (indices 11120-11134)
3. CZ_ADM2 paints ON TOP of CZ NUTS (canvas is opaque; later draws cover earlier)

This means CZ_ADM2 SHOULD be visible even without clipping. However, the overlap creates visual artifacts where the CZ_ADM2 edges might not perfectly align with the CZ NUTS geometry, creating subtle rendering issues.

### Verification Steps for User

Open browser DevTools console after applying the 1939 scenario and run:

```javascript
// 1. Check composite mode
console.log("Bundle mode:", state.topologyBundleMode);
// Expected: "composite"

// 2. Check feature count
console.log("LandData features:", state.landData?.features?.length);
// Expected: > 10000

// 3. Check CZ_ADM2 sovereignty
console.log("CZ_ADM2 owner:", state.sovereigntyByFeatureId["CZ_ADM2_57006924B74936445485800"]);
// Expected: "GER"

// 4. Check CZ_ADM2 has a color
console.log("CZ_ADM2 color:", state.colors["CZ_ADM2_57006924B74936445485800"]);
// Expected: a hex color string (GER's color)

// 5. Check GER base color
console.log("GER base color:", state.sovereignBaseColors["GER"]);
// Expected: "#666057"
```

### Fix Recommendations

**[P0] Increase color contrast** between GER and BOM. Change BOM's `color_hex` in `data/scenarios/hoi4_1939/countries.json` from `#6a4b3a` (dark brown) to a more distinct color — e.g., `#4a7d5c` (muted green) or `#8b7355` (lighter tan). This is the quickest fix to make the Sudetenland visible.

**[P1] Add visual indicator for refined regions**. Options:
- Draw a thin dashed internal border for CZ_ADM2/SK_ADM2 features in ALL scenarios (even when same owner), to show the tile refinement exists
- Add a subtle hatch pattern or lighter shade for detail-tier features
- Show a tooltip: "Sudetenland district (detail)" on hover

**[P2] Ensure proper geometric clipping**. Verify that the `cz_sk_border_detail.py` processor output actually clips the CZ NUTS features. If the CZ NUTS features are unclipped, regenerate na_v2.json with proper subtraction. This eliminates the overlap and makes the boundary cleaner.

**[P2] Expose a "Show Detail Boundaries" toggle** that draws internal borders between all detail-tier features regardless of ownership, so users can verify the refinement exists.

---

## Issue 2: Reichskommissariat Preset Activation UX Too Complex

### Current Interaction Flow (5 Clicks)

After loading the 1939 scenario:

| Step | Action | UI Element | Location |
|---|---|---|---|
| 1 | Expand Germany's releasables | Click chevron "▸" next to "Germany (GER)" | Left sidebar → Country list |
| 2 | Select a Reichskommissariat | Click "RK Ukraine (RK_UKR)" in expanded list | Left sidebar → GER children |
| 3 | Set as Active sovereign | Click "Set Active" button | Right sidebar → Inspector |
| 4 | (Automatic) Core Territory action appears | — | Right sidebar → Actions |
| 5 | Apply territory | Click "Apply Core Territory" button | Right sidebar → Actions panel |

**Total: 5 clicks across two sidebar panels**, requiring the user to understand the concept of "active sovereign" and navigate between country selection and territory application.

### Pain Points

1. **Conceptual overhead**: "Set Active" is an intermediate state that has no obvious purpose to the user. They just want to "activate" the Reichskommissariat.
2. **Cross-panel navigation**: Steps 1-2 happen in the left sidebar, steps 3-5 in the right sidebar. The user must mentally track state across two panels.
3. **Hidden prerequisite**: The "Apply Core Territory" button only appears after "Set Active" is clicked. There's no affordance showing what to do next.
4. **Toast message is instruction-heavy**: "Scenario loaded. 1) Select a country 2) Set Active 3) Apply Core/Presets." — this is a tutorial in a toast.

### Simplification Recommendations

**Option A: One-Click "Activate" Button (Recommended)**

Replace the 5-click flow with a single "Activate" button next to each Reichskommissariat in the expanded GER children list. Clicking it would:
1. Set the RK as active sovereign
2. Immediately apply its core territory preset
3. Show a success toast

This reduces the flow to: **Expand GER → Click "Activate RK_UKR"** (2 clicks).

Implementation sketch:
```javascript
// In renderCountrySelectRow(), for releasable children:
const activateBtn = document.createElement("button");
activateBtn.textContent = t("Activate", "ui");
activateBtn.className = "btn-xs btn-success";
activateBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  state.activeSovereignCode = countryState.code;
  applyScenarioReleasableCoreTerritory(countryState, { source: "quick-activate" });
});
row.appendChild(activateBtn);
```

**Option B: Context Menu on Right-Click**

Right-clicking a Reichskommissariat shows a context menu with:
- "Activate Territory"
- "Set Active (Paint Mode)"
- "View Details"

**Option C: Double-Click to Activate**

Double-clicking a Reichskommissariat in the list triggers the full activation + territory apply flow.

**Option D: Batch Activation**

Add an "Activate All Reichskommissariats" button at the GER country level. This would apply all RK territories at once — useful for quickly setting up the full occupation map.

### Recommended: Option A + D Combined

- **Quick-activate button** per RK for individual activation (2 clicks)
- **"Activate All" button** at the Germany level for batch setup (2 clicks)
- Keep the existing 5-click flow as an advanced option for users who want fine-grained control

---

## Issue 3: Reichskommissariat Boundary Accuracy

### Overview

All 8 Reichskommissariats use **manually curated `feature_ids` lists** in `data/releasables/hoi4_vanilla.internal.phase1.source.json`. None use auto-generated ISO/NUTS boundaries. However, the feature ID lists appear to have been derived from modern administrative boundaries rather than historical 1939-era German occupation zones.

### Audit Results

#### RKN — Reichskommissariat Niederlande (Netherlands)
- **Features**: 40 Dutch NUTS-3 regions (NL111, NL112, ..., NL423)
- **Assessment**: **CORRECT** — covers modern Netherlands which matches the historical 1940-1945 occupation zone.

#### RKNO — Reichskommissariat Norwegen (Norway)
- **Features**: 12 Norwegian NUTS-3 regions (NO020, NO060, ..., NO0B1)
- **Assessment**: **CORRECT** — covers major Norwegian administrative regions matching the historical occupation.

#### RKB — Reichskommissariat Belgien-Nordfrankreich (Belgium-N.France)
- **Features**: 70 features (Belgian NUTS-3 + French arrondissements)
- **Belgian portion**: BE100-BE353 — correct
- **French portion**: FR_ARR_02xxx (Aisne), FR_ARR_59xxx (Nord), FR_ARR_60xxx (Oise), FR_ARR_62xxx (Pas-de-Calais), FR_ARR_80xxx (Somme)
- **Assessment**: **BOUNDARY ERROR** — Département 60 (Oise) and parts of Départements 02 (Aisne) and 80 (Somme) extend into the **Picardy region**, which was historically NOT part of the Militärverwaltung/Reichskommissariat. The German Military Administration in Belgium and Northern France covered:
  - All of Belgium
  - French départements Nord (59) and Pas-de-Calais (62) only
- **Fix**: Remove FR_ARR_02xxx, FR_ARR_60xxx, FR_ARR_80xxx features. Keep only FR_ARR_59xxx and FR_ARR_62xxx.

#### RKP — Generalgouvernement (Poland)
- **Features**: 380 Polish Powiat (county) features (PL_POW_xxxx)
- **Assessment**: **MAJOR BOUNDARY ERROR** — Uses modern Polish administrative divisions which represent post-WWII Poland (including Silesia, Pomerania, East Prussia, and western territories). The historical 1939 Generalgouvernement was much smaller:
  - Central Poland only (Warsaw, Kraków, Lublin, Radom districts)
  - **Excluded**: Western Poland (annexed directly into the Reich as Wartheland and Danzig-West Prussia), eastern Poland (annexed by the USSR per Molotov-Ribbentrop)
  - The GG territory was roughly: Warsaw, Kielce, Kraków, Lublin, and Radom regions
- **Fix**: Remap to only the PL_POW features that fall within the historical Generalgouvernement boundary (approximately the Kraków, Warsaw, Lublin, and Radom districts). This would reduce the feature count from 380 to approximately 150-200 features. The remaining Polish territory should be assigned to GER (annexed into the Reich) or left as part of the Soviet sphere.

#### RKU — Reichskommissariat Ukraine
- **Features**: 495 Ukrainian Raion features (UA_RAY_xxxx)
- **Assessment**: **MAJOR BOUNDARY ERROR** — Uses modern Ukrainian administrative boundaries, which represent present-day Ukraine. The historical Reichskommissariat Ukraine (1941-1944):
  - Did NOT exist in 1939 (Germany didn't invade the USSR until 1941)
  - When established in 1941, it covered central Ukraine (excluding Galicia which was part of the Generalgouvernement, and excluding areas near the front)
  - Roughly: Volyn, Zhytomyr, Kyiv, Poltava, Dnipropetrovsk, Mykolaiv, Zaporizhzhia, Taurida regions
  - **Excluded**: Donbas (under military admin), Crimea (under military admin), Galicia (part of GG), Transcarpathia (part of Hungary)
- **Fix**: This is a planned/hypothetical Reichskommissariat (Germany's planned post-war occupation zones per Generalplan Ost). If this is intentional HOI4 game content, remap to the in-game territory definition. If historical accuracy is the goal, restrict to the actual 1941-1944 RKU boundaries.

#### RKO — Reichskommissariat Ostland
- **Features**: 56 features (Baltic NUTS + Belarus raions)
- **Assessment**: **MOSTLY CORRECT** — Covers Estonia (EE), Latvia (LV), Lithuania (LT), and western Belarus. The historical RKO covered the Baltic states + western Belarus (Minsk, Baranovichi). The Belarus raion selection should be verified against the actual 1941-1944 RKO eastern boundary (approximately the Minsk-Vitebsk-Mogilev line).

#### RKM — Reichskommissariat Moskowien (Moscow)
- **Features**: 283 Russian Raion features (RU_RAY_xxxx + RU_CITY_MOSCOW)
- **Assessment**: **BOUNDARY ERROR (scope unclear)** — This Reichskommissariat was a **planned but never implemented** German occupation zone. It existed only as a concept in Nazi planning documents. With 283 features, it's unclear what geographical extent is intended.
  - The HOI4 game defines Reichskommissariat Moskowien as covering a large area around Moscow and extending to the Urals
  - If following HOI4 definitions, 283 raions may be too few (should extend further north and east)
  - If following historical planning documents, the extent is even more uncertain
- **Fix**: Cross-reference against HOI4 game state definitions for RK Moskau. The in-game territory is well-defined with specific state IDs that can be mapped to our raion features.

#### RKK — Reichskommissariat Kaukasien (Caucasus)
- **Features**: 243 features (Armenia, Azerbaijan, Georgia + Russian Caucasus raions)
- **Assessment**: **SCOPE UNCLEAR** — Like RKM, this was a planned-only Reichskommissariat. The feature selection appears to cover the entire Transcaucasus + North Caucasus. For HOI4 consistency, cross-reference against the game's state definitions.

### Summary of Boundary Issues

| RK | Status | Issue | Fix Effort |
|---|---|---|---|
| RKN (Netherlands) | **Correct** | — | — |
| RKNO (Norway) | **Correct** | — | — |
| RKB (Belgium-N.France) | **Error** | Picardy included | Low (remove ~16 FR_ARR features) |
| RKP (Poland/GG) | **Major Error** | Uses modern Poland borders | High (remap ~200 features) |
| RKU (Ukraine) | **Major Error** | Uses modern Ukraine borders | High (remap ~300 features) |
| RKO (Ostland) | **Mostly Correct** | Belarus extent needs verification | Low |
| RKM (Moscow) | **Unclear** | Planned-only territory; extent uncertain | Medium (HOI4 cross-ref) |
| RKK (Caucasus) | **Unclear** | Planned-only territory; extent uncertain | Medium (HOI4 cross-ref) |

### Root Cause Pattern

The boundary errors follow a consistent pattern: **modern national administrative boundaries were used as proxies for historical occupation zones**. The Reichskommissariat feature lists appear to have been generated by selecting all administrative units (Powiats, Raions, etc.) within a modern country's borders, rather than mapping to the specific historical 1939/1941 occupation zone boundaries.

The fix approach for all errored RKs is the same:
1. Identify the historical boundary from HOI4 game data or historical maps
2. Select only the `PL_POW_`, `UA_RAY_`, etc. features that fall within the historical boundary
3. Update the feature ID lists in `data/releasables/hoi4_vanilla.internal.phase1.source.json`

### Recommended Approach for Corrections

Since this project targets HOI4 scenarios, the most practical reference for boundaries is the **HOI4 game state map**. Each HOI4 state has a well-defined set of provinces. The mapping workflow would be:

1. For each Reichskommissariat, identify the HOI4 state IDs that belong to it
2. Map HOI4 states to our topology features using geographic overlap
3. Generate corrected feature ID lists
4. Update the releasable source file

---

## Appendix: File References

| Resource | Path |
|---|---|
| CZ/SK processor | `map_builder/processors/cz_sk_border_detail.py` |
| Detail topology | `data/europe_topology.na_v2.json` (11,196 features) |
| Runtime political | `data/europe_topology.runtime_political_v1.json` (11,222 features) |
| Primary topology | `data/europe_topology.json` (199 features) |
| 1939 countries | `data/scenarios/hoi4_1939/countries.json` |
| 1939 owners | `data/scenarios/hoi4_1939/owners.by_feature.json` |
| Releasable catalog source | `data/releasables/hoi4_vanilla.internal.phase1.source.json` |
| Releasable catalog builder | `tools/build_hoi4_releasable_catalog.py` |
| Compose function | `js/core/map_renderer.js:946-992` |
| Canvas paint loop | `js/core/map_renderer.js:3890-3934` |
| Border mesh builder | `js/core/map_renderer.js:1667-1693` |
| Preset activation flow | `js/ui/sidebar.js:1471-1545, 1906-1933, 2175-2225` |
