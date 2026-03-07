# QA-056: Reichskommissariat Boundary Misalignment Diagnostic

> Superseded on 2026-03-06 by `QA-059_hoi4_reichskommissariat_boundary_revalidation_and_historical_transfers_2026-03-06.md`.
> QA-056 captured the initial mismatch symptoms, but several conclusions here are no longer the current source of truth after HOI4 trigger revalidation and the new boundary-variant / historical-transfer implementation.

**Date**: 2026-03-05
**Severity**: HIGH
**Scope**: Reichskommissariat territory definitions — RKP, RKO, RKU, RKM
**Related**: QA-055
**Reference images**: `qa/example image/example komminisariat.png` (intent), `qa/example image/current 1939.png` (current)

---

## Summary

Visual comparison of the HOI4 reference map against the current 1939 scenario reveals significant territory misalignment in four of the six Reichskommissariats. RKB (Belgium) and RKN (Norway, if defined elsewhere) appear correct. The issues stem from the boundary spec file (`data/releasables/hoi4_reichskommissariat_boundaries.internal.json`) missing hierarchy groups, containing phantom feature IDs, and having critical inter-RK overlaps.

---

## Issue 1: RKP (Generalgouvernement Polen) — Missing Galicia & Radom

### Symptom
Poland's General Government territory is too small. It does not extend into eastern Galicia (Lwów/Lviv, Tarnopol/Ternopil), and the Radom district (Distrikt Radom) area appears incomplete.

### Root Cause

The boundary spec defines RKP using **modern Polish voivodeship groups only**:

| Included Group | Historical District Proxy | Features |
|---|---|---:|
| `PL_Masovian` | Distrikt Warschau | 42 |
| `PL_Holy_Cross` | Distrikt Radom (partial) | 14 |
| `PL_Lublin` | Distrikt Lublin | 24 |
| `PL_Lesser_Poland` | Distrikt Krakau | 22 |
| `PL_Subcarpathian` | Distrikt Krakau (east) | 25 |
| **Total materialized** | | **127** |

**Missing groups for Galicia (Distrikt Galizien, added 1941):**

| Missing Group | Region | Features | Should Be In |
|---|---|---:|---|
| `UA_Lviv` | Lwów / Lemberg | 20 | RKP |
| `UA_Ternopil` | Tarnopol | 17 | RKP |
| `UA_Ivano_Frankivsk` | Stanisławów | 14 | RKP |

**Radom coverage gap:**

The historical Distrikt Radom included parts of modern Łódź Voivodeship. `PL_Lodz` (22 features) is NOT in the spec. Specific eastern powiats from `PL_Lodz` that fall within the Radom district boundary are missing. Whether to include the entire `PL_Lodz` group or only select powiats requires manual review against the HOI4 state map.

### Recommended Fix

```json
"include_hierarchy_group_ids": [
  "PL_Masovian",
  "PL_Holy_Cross",
  "PL_Lublin",
  "PL_Lesser_Poland",
  "PL_Subcarpathian",
  "UA_Lviv",          // ← ADD: Galicia / Distrikt Galizien
  "UA_Ternopil",      // ← ADD: Galicia
  "UA_Ivano_Frankivsk" // ← ADD: Galicia / Stanisławów
]
```

For Radom: either add `PL_Lodz` as a whole group, or selectively include specific PL_POW_10xx powiats from the eastern part of Łódź Voivodeship.

**Note on Chernivtsi (UA_Chernivtsi):** Northern Bukovina was Romanian, then Soviet, then occupied. Depending on the HOI4 GG boundary, `UA_Chernivtsi` (11 features) may or may not belong to RKP. Verify against HOI4 state definitions.

---

## Issue 2: RKO (Ostland) ↔ RKM (Moskowien) — Critical Overlap

### Symptom
The Belarus-Lithuania border region appears incorrectly assigned or double-claimed. Some Belarusian districts that should be in Ostland may render as Moskowien depending on processing order.

### Root Cause

Both the RKO and RKM boundary specs include `BY_Grodno` and `BY_Vitebsk`, causing **18 features** to be claimed by both Reichskommissariats:

```
Overlap (18 features):
  BY_HIST_POL_VITEBSK_WEST
  BY_INT_GRODNO
  BY_INT_VITEBSK
  BY_RAY_67162791B13547290723272   (Grodno raion)
  BY_RAY_67162791B1773631612848    (Vitebsk raion)
  BY_RAY_67162791B18102707107362   (Vitebsk raion)
  BY_RAY_67162791B18933715013959   (Grodno raion)
  BY_RAY_67162791B19917337499758   (Vitebsk raion)
  BY_RAY_67162791B30546828632542   (Vitebsk raion)
  BY_RAY_67162791B41761210959552   (Vitebsk raion)
  BY_RAY_67162791B43104058935452   (Grodno raion)
  BY_RAY_67162791B45929653886900   (Vitebsk raion)
  BY_RAY_67162791B54270193950847   (Grodno raion)
  BY_RAY_67162791B65560195088656   (Vitebsk raion)
  BY_RAY_67162791B66420794580046   (Grodno raion)
  BY_RAY_67162791B82603429459213   (Vitebsk raion)
  BY_RAY_67162791B85815486219336   (Vitebsk raion)
  BY_RAY_67162791B89656925241953   (Grodno raion)
```

**RKO-exclusive BY features (5):** `BY_HIST_POL_MINSK_WEST`, `BY_INT_BREST`, `BY_INT_MINSK`, and 2 raions from Brest/Minsk groups.

**RKM-exclusive BY features:** None — every BY_ feature in RKM is also in RKO.

### Additional RKO gap

The boundary spec does NOT include `BY_Mogilev` (8 features) or `BY_Gomel` (5 features). The western parts of Mogilev oblast were historically within Ostland's operational area. Whether these should be in RKO or RKM depends on the HOI4 state boundaries.

### Recommended Fix

1. **Remove** `BY_Grodno` and `BY_Vitebsk` from the RKM spec — these belong to Ostland, not Moskowien.
2. Review whether `BY_Mogilev` should be split between RKO and RKM or assigned entirely to one.

---

## Issue 3: RKU (Ukraine) — Missing Central/Eastern Oblasts

### Symptom
The Ukraine Reichskommissariat is missing significant territory in central Ukraine. Poltava, Chernihiv, and Kirovohrad oblasts are visually absent. Zaporizhzhia and Luhansk are also not included.

### Root Cause

The RKU spec includes 14 of 24 available Ukrainian hierarchy groups. **10 groups are missing:**

| Missing Group | Region | Features | Historical RKU? | Notes |
|---|---|---:|---|---|
| **`UA_Poltava`** | Полтава | 25 | **YES** | Core RKU territory |
| **`UA_Chernihiv`** | Чернігів | 22 | **YES** | Core RKU territory |
| **`UA_Kirovohrad`** | Кіровоград | 22 | **YES** | Core RKU territory |
| **`UA_Zaporizhzhia`** | Запоріжжя | 20 | **YES** | Eastern RKU / military zone |
| **`UA_Luhansk`** | Луганськ | 18 | Partial | Eastern fringe, military admin |
| `UA_Lviv` | Львів | 20 | No | → Should be in RKP (Galicia) |
| `UA_Ternopil` | Тернопіль | 17 | No | → Should be in RKP (Galicia) |
| `UA_Ivano_Frankivsk` | Івано-Франківськ | 14 | No | → Should be in RKP (Galicia) |
| `UA_Chernivtsi` | Чернівці | 11 | No | Romanian / ambiguous |
| `UA_Zakarpattia` | Закарпаття | 13 | No | Hungarian-controlled |

The first 5 groups (107 features) are clearly within RKU's historical territory and must be added.

### Phantom Fringe IDs

The boundary spec lists 6 explicit `include_feature_ids` for RKU. **All 6 are phantom — they do not exist in the runtime topology:**

```
UA_RAY_74538382B90572707310825   ← NOT IN TOPOLOGY
UA_RAY_74538382B8704633300515    ← NOT IN TOPOLOGY
UA_RAY_74538382B34689599554445   ← NOT IN TOPOLOGY
UA_RAY_74538382B84040377374615   ← NOT IN TOPOLOGY
RU_RAY_50074027B21430544456221   ← NOT IN TOPOLOGY
RU_RAY_50074027B36141655472455   ← NOT IN TOPOLOGY
```

Despite being phantom, the materializer copied them into the source.json where they sit as dead entries (the renderer cannot match them to any geometry). The 2 RU_ fringe IDs appear in the materialized list but resolve to nothing.

### Recommended Fix

```json
"include_hierarchy_group_ids": [
  "UA_Volyn", "UA_Rivne", "UA_Zhytomyr", "UA_Khmelnytskyi",
  "UA_Vinnytsia", "UA_Kyiv", "UA_Cherkasy", "UA_Odessa",
  "UA_Mykolaiv", "UA_Kherson", "UA_Dnipropetrovsk", "UA_Kharkiv",
  "UA_Donetsk", "UA_Sumy",
  "UA_Poltava",        // ← ADD
  "UA_Chernihiv",      // ← ADD
  "UA_Kirovohrad",     // ← ADD
  "UA_Zaporizhzhia",   // ← ADD
  "UA_Luhansk"         // ← ADD (partial, verify eastern edge)
]
```

Remove or replace the 6 phantom `include_feature_ids` with valid IDs if fringe coverage is still needed.

---

## Issue 4: RKM (Moskowien) — Over-extended Southern/Eastern Reach

### Symptom
The Moscow Reichskommissariat extends far south and east, including regions like Voronezh, the Donets basin (Rostov), Volgograd, Saratov, Ulyanovsk, Penza, Nizhny Novgorod, Ryazan, and others. The reference map shows a more bounded territory.

### Root Cause

The RKM spec includes **24 hierarchy groups** spanning from Arkhangelsk to Rostov and from Smolensk to Nizhny Novgorod. Materialized result: **809 features** (791 RU + 18 BY).

Groups that may be over-extending beyond HOI4's RKM boundary:

| Potentially Over-extended Group | Features | Issue |
|---|---:|---|
| `RU_Voronezh` | 34 | Far south, may partially overlap RKU/military zone |
| `RU_Rostov` | 55 | Donets basin area, near RKK boundary |
| `RU_Volgograd` | 37 | Very far south-east, near Astrakhan (RKK) |
| `RU_Saratov` | 40 | Far east of A-A line |
| `RU_Ulyanovsk` | 24 | Beyond A-A line |
| `RU_Penza` | 30 | Beyond A-A line |
| `RU_Nizhny_Novgorod` | 50 | At/beyond A-A line |

Additionally, RKM includes the **18 overlapping BY_ features** discussed in Issue 2.

### Phantom Fringe IDs (RKM)

The RKM spec lists 7 explicit `include_feature_ids`. Spot-checking shows at least some exist in hierarchy.json but **NOT in the runtime topology** (`europe_topology.runtime_political_v1.json`):

```
RU_CITY_ARKHANGELSK               ← verify
RU_RAY_50074027B17636475236668    ← NOT IN RUNTIME TOPOLOGY
RU_RAY_50074027B90519354478842    ← verify
RU_RAY_50074027B14748896560246    ← verify
RU_RAY_50074027B40605874483535    ← verify
RU_RAY_50074027B38735593525636    ← verify
RU_RAY_50074027B90540436425293    ← verify
```

### Recommended Fix

1. Remove `BY_Grodno` and `BY_Vitebsk` from the spec (belong to RKO).
2. Review whether `RU_Rostov`, `RU_Volgograd`, `RU_Saratov`, `RU_Ulyanovsk`, `RU_Penza`, `RU_Nizhny_Novgorod` should be included based on the HOI4 A-A line boundary.
3. Validate all 7 fringe IDs against the runtime topology; replace phantoms with valid IDs.

---

## Cross-Cutting Issue: Phantom Feature IDs

Multiple RK specs reference feature IDs that do not exist in the runtime topology. This is a systemic data quality issue:

| RK | Phantom IDs | Impact |
|---|---:|---|
| RKU | 6 | Fringe districts not rendered |
| RKM | 1+ (confirmed) | Edge districts not rendered |
| RKK | 2 (unverified) | Possibly missing fringe |

**Root cause hypothesis**: The feature IDs were generated against an older or different topology version. The current `europe_topology.runtime_political_v1.json` may have been rebuilt with different ID generation, making these references stale.

---

## Materialization Summary

| Tag | Display Name | Features | BY Overlap | Missing Groups | Phantom IDs |
|---|---|---:|---:|---|---:|
| RKB | RK Belgien | 57 | 0 | None | 0 |
| RKP | RK Polen | 127 | 0 | UA_Lviv, UA_Ternopil, UA_Ivano_Frankivsk, PL_Lodz(?) | 0 |
| RKO | RK Ostland | 44 | 18 (with RKM) | BY_Mogilev(?) | 0 |
| RKU | RK Ukraine | 315 | 0 | UA_Poltava, UA_Chernihiv, UA_Kirovohrad, UA_Zaporizhzhia, UA_Luhansk | 6 |
| RKK | RK Kaukasus | 274 | 0 | Unaudited | 2 (unverified) |
| RKM | RK Moskowien | 809 | 18 (with RKO) | Over-extended south/east | 1+ |

---

## Action Items

| # | Priority | Action | File |
|---|---|---|---|
| 1 | **P0** | Add `UA_Lviv`, `UA_Ternopil`, `UA_Ivano_Frankivsk` to RKP | `hoi4_reichskommissariat_boundaries.internal.json` |
| 2 | **P0** | Add `UA_Poltava`, `UA_Chernihiv`, `UA_Kirovohrad`, `UA_Zaporizhzhia` to RKU | same |
| 3 | **P0** | Remove `BY_Grodno`, `BY_Vitebsk` from RKM spec | same |
| 4 | **P1** | Evaluate `PL_Lodz` partial inclusion for RKP Radom district | same |
| 5 | **P1** | Evaluate `UA_Luhansk` inclusion in RKU | same |
| 6 | **P1** | Audit RKM southern/eastern groups against HOI4 A-A line | same |
| 7 | **P2** | Remove or replace all phantom `include_feature_ids` | same |
| 8 | **P2** | Re-run materializer after fixes and verify audit report | `tools/materialize_hoi4_reichskommissariat_boundaries.py` |

---

## Files Involved

| File | Role |
|---|---|
| `data/releasables/hoi4_reichskommissariat_boundaries.internal.json` | Boundary spec (source of truth for territory rules) |
| `data/releasables/hoi4_vanilla.internal.phase1.source.json` | Materialized feature ID lists (generated output) |
| `data/hierarchy.json` | Hierarchy group → feature ID mapping |
| `data/europe_topology.runtime_political_v1.json` | Runtime topology (feature geometry) |
| `tools/materialize_hoi4_reichskommissariat_boundaries.py` | Materializer script |
| `scenario_builder/hoi4/parser.py` | Parser for hierarchy groups (verified correct) |
