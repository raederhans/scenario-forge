# QA-054: HOI4 1939 CZ/SK Border Refinement & China-Japan Frontline Audit

**Date**: 2026-03-05
**Severity**: High
**Scope**: Scenario rendering (topology composition), data completeness
**Related**: QA-052, QA-053

---

## Executive Summary

Three interrelated issues were reported after the HOI4 1939 scenario implementation:

1. **Sudetenland / South Slovakia border refinement not visible** in any scenario
2. **Bohemia-Moravia Protectorate (BOM)** incorrectly renders as all of Czechia
3. **China-Japan frontline** shows no visible changes in either ownership or frontline view

Root cause analysis reveals **two distinct failure categories**: a topology composition gap (Issues 1 & 2) and a data completeness / UI discoverability problem (Issue 3).

---

## Issue 1: CZ/SK Border Refinement Invisible

### Symptom

The 18 Sudetenland districts (`CZ_ADM2_*`) and 12 South Slovakia districts (`SK_ADM2_*`) created by `cz_sk_border_detail.py` are not rendered in the browser, in any scenario.

### Data State (Verified Correct)

| Topology File | CZ features | CZ_ADM2 features | SK features | SK_ADM2 features |
|---|---|---|---|---|
| `europe_topology.json` (primary) | 14 (original, unclipped) | **0** | ~8 | **0** |
| `europe_topology.na_v2.json` (detail) | 14 (clipped) | **18** | 8 (clipped) | **12** |
| `europe_topology.runtime_political_v1.json` | 14 + 18 = 32 | (included) | 8 + 12 = 20 | (included) |

The `cz_sk_border_detail.py` processor correctly:
- Creates 18 CZ_ADM2 Sudetenland features from Czech ADM2 boundaries
- Creates 12 SK_ADM2 South Slovakia features from Slovak ADM2 boundaries
- **Clips** the original CZ/SK NUTS features to subtract the target areas (verified: arc complexity differs significantly between base and na_v2)
- Outputs everything into `na_v2.json`

The 1939 scenario data correctly assigns:
- **GER** → 18 `CZ_ADM2_*` features (Sudetenland)
- **BOM** → 13 `CZ0xx` features (Bohemia-Moravia remainder)
- **HUN** → 12 `SK_ADM2_*` features (South Slovakia)
- **SLO** → 8 `SK0xx` features (independent Slovakia)
- **POL** → `CZ080` (Zaolzie/Teschen)

### Root Cause

**The primary topology `europe_topology.json` contains zero `CZ_ADM2` / `SK_ADM2` features.** These features only exist in the detail topology (`na_v2.json`). For them to render, the app must operate in **composite bundle mode** (`topologyBundleMode === "composite"`).

The composite mode activation path:

```
App startup
  → resolveRenderProfile()  → default "auto"
  → shouldDeferDetailLoad() → returns TRUE for most devices
     (deviceMemory ≤ 8 OR hardwareConcurrency ≤ 8 OR dpr > 1.5)
  → Detail loading DEFERRED → starts in "single" mode

Scenario apply
  → applyScenarioBundle()
  → await ensureScenarioDetailTopologyLoaded()
  → loadDeferredDetailBundle()
     → loads na_v2.json + runtime_political_v1.json
  → state.topologyBundleMode = "composite"
  → setMapData() → composePoliticalFeatures(primary, detail)
```

**Possible failure points:**

1. **`ensureScenarioDetailTopologyLoaded()` silently fails** — the function catches errors at line 508-510 and only logs a warning. If `na_v2.json` fails to load (network error, parsing error, CORS issue with local file:// serving), the function returns `false` and the scenario applies in single mode.

2. **`state.detailPromotionInFlight` guard** — if a previous failed attempt set this flag but the `finally` block didn't execute (unlikely but possible in edge cases), subsequent calls return `false` immediately.

3. **`setMapData()` called inside `ensureScenarioDetailTopologyLoaded()` (line 506) resets sovereignty** (line 5512: `state.sovereigntyInitialized = false`) — but `applyScenarioBundle()` also resets sovereignty later (line 641-642). This ordering should be fine, but the double-reset is worth noting.

### How to Verify

Open browser DevTools console and look for these messages when applying the 1939 scenario:
- `[data_loader] Loaded detail topology data/europe_topology.na_v2.json (11196 features).` — **must appear**
- `[scenario] Detail topology could not be promoted.` — **must NOT appear**
- `[map_renderer] Composite coverage: countries detail=...` — **must appear**

If the detail topology load message is missing, check for network/fetch errors in the console.

### Fix Recommendation

**Option A (Quick fix):** Force detail loading on startup by adding `?render_profile=full` to the URL, bypassing the deferred loading heuristic.

**Option B (Robust fix):** In `ensureScenarioDetailTopologyLoaded()`, if the deferred load fails, add an explicit retry with a user-visible error toast:

```javascript
// After the catch block at line 508-510:
if (!resolvedDetail) {
  showToast("Detail topology could not be loaded. Border refinements will not be visible.", {
    tone: "error", duration: 6000
  });
}
```

**Option C (Best fix):** Pre-bake the CZ_ADM2/SK_ADM2 features into the primary topology `europe_topology.json` so they're available even in single mode. This eliminates the dependency on composite mode for these scenario-critical features.

---

## Issue 2: Bohemia-Moravia Protectorate Shows All of Czechia

### Symptom

The BOM (Bohemia-Moravia) protectorate renders as the entirety of Czechia, not excluding the Sudetenland regions.

### Root Cause

**This is a direct consequence of Issue 1.** When composite mode fails to activate:

- BOM is assigned to 13 features: `CZ010`, `CZ020`, `CZ031`..`CZ072`
- In **single mode**, these are the **original unclipped** CZ NUTS geometries from `europe_topology.json`, covering all of Czechia
- GER's 18 `CZ_ADM2_*` features don't exist in the primary topology → they render as nothing
- Result: BOM = all of Czechia, Sudetenland invisible

In **composite mode** (working correctly):
- The same `CZ010`..`CZ072` IDs in `na_v2.json` are **clipped geometries** with Sudetenland areas subtracted
- GER's `CZ_ADM2_*` features render as the Sudetenland overlay
- Result: BOM = Czechia minus Sudetenland, GER = Sudetenland ✓

### Fix

Fixing Issue 1 (ensuring composite mode activates) will automatically fix this issue. No separate data changes needed.

---

## Issue 3: China-Japan Frontline Not Visible

### Symptom

Neither ownership view nor frontline view shows any Chinese-Japanese theater modifications in the 1939 scenario.

### Analysis — Two Sub-Problems

#### Sub-Problem 3A: Ownership View Shows No Obvious Changes

**This is partially by design.** The ownership view shows legal sovereignty:

| Entity | 1936 Features | 1939 Features | Delta |
|---|---|---|---|
| CHI (China) | 1,031 | 1,132 | +101 |
| MAN (Manchukuo) | 235 | 235 | 0 |
| JAP (Japan) | 86 | 86 | 0 |
| MEN (Mengjiang) | 23 | 17 | -6 |
| YUE (Guangdong) | 95 | **0** | -95 |

The +101 CHI / -95 YUE change reflects Guangdong being absorbed into Nationalist China, **not** Japanese expansion. Japan and Manchukuo territory is **unchanged** in ownership because China legally still claims the occupied territory. This is historically correct for the ownership perspective.

However, this design choice means the ownership view looks nearly identical between 1936 and 1939 for the Chinese theater — which is confusing to users who expect to see the 1937-1939 Japanese invasion reflected.

#### Sub-Problem 3B: Frontline View — Correct but Insufficient

The 1939 controller data has **24 split features** (owner ≠ controller):
- 6 features: CHI owned → MEN controlled (Hebei-Chahar corridor)
- 18 features: CHI owned → JAP controlled (Hainan + Jidong bridgehead)

**These 24 features are correct** per the implemented controller rules:

| Rule | Tag | Features | Area |
|---|---|---|---|
| `1939_frontline_hebei_chahar_mengjiang_control` | MEN | 6 | Chahar corridor |
| `1939_frontline_hainan_japanese_control` | JAP | CN_Hainan group | Hainan island |
| `1939_frontline_jidong_bridgehead` | JAP | 18 | Northern Hebei |

**But 24 features is dramatically insufficient.** By early 1939, Japan controlled:
- All of northeast China (already MAN — 235 features)
- Beijing, Tianjin, Shanghai, Nanjing, Wuhan, Guangzhou and surrounding areas
- Most of coastal eastern China
- Major railway corridors

The current rules only capture Hainan, a small Hebei bridgehead, and a Chahar corridor. The vast majority of Japanese-occupied eastern China (hundreds of CN_CITY features) has **no controller rule** and defaults to CHI control.

#### Sub-Problem 3C: CN_CITY Features Depend on Composite Mode

Like the CZ/SK features, CN_CITY features (2,391 total) **only exist in `na_v2.json`** (detail topology). The primary topology `europe_topology.json` has only 1 CN feature.

If composite mode fails to activate (Issue 1), then:
- The 24 controller-split CN_CITY feature IDs have no matching geometry in the rendered topology
- The entire Chinese theater renders as a single monolithic feature
- Neither ownership nor frontline coloring can show any sub-national detail

**This means Issue 1 blocks Issue 3 as well.**

### Fix Recommendations

**Step 1:** Fix composite mode (Issue 1) to ensure CN_CITY features render.

**Step 2:** Verify frontline toggle visibility:
- Open 1939 scenario → check the "View" dropdown in sidebar
- Toggle from "Ownership" to "Frontline"
- The 24 features should change color (JAP/MEN instead of CHI)

**Step 3:** Expand controller rules to cover the actual 1939 Japanese occupation zone. Priority areas to add:

| Area | Approximate Feature Count | Controller |
|---|---|---|
| Beijing-Tianjin metropolitan | ~30-50 CN_CITY features | JAP |
| Shanghai-Nanjing corridor | ~40-60 CN_CITY features | JAP (or Nanjing puppet govt) |
| Wuhan tri-cities | ~15-20 CN_CITY features | JAP |
| Guangzhou-Pearl River Delta | ~20-30 CN_CITY features | JAP |
| Shandong peninsula | ~30-40 CN_CITY features | JAP |
| Shanxi-Hebei occupied zones | ~40-60 CN_CITY features | JAP |

This would likely require a new rule file or expansion of `hoi4_1939.controller.manual.json` with careful feature selection using the hierarchy system or manual feature ID lists.

---

## Summary of Root Causes

| Issue | Root Cause | Category |
|---|---|---|
| CZ/SK refinement invisible | Detail topology (na_v2) not loading → composite mode inactive | **Rendering pipeline** |
| BOM = all of Czechia | Consequence of above — unclipped primary geometry used | **Rendering pipeline** |
| China-Japan ownership unchanged | By design (ownership ≠ control), but unintuitive | **Design/UX** |
| China-Japan frontline invisible | (a) Composite mode inactive blocks CN_CITY rendering; (b) Only 24/hundreds of features have controller rules | **Rendering pipeline + Data completeness** |

## Priority Actions

1. **[P0] Diagnose composite mode activation** — check browser console for detail topology load messages
2. **[P0] If composite mode fails:** investigate why `loadDeferredDetailBundle()` fails; consider Option C (pre-baking detail features into primary topology)
3. **[P1] Expand China-Japan controller rules** to cover the full Japanese occupation zone (~200-300 additional CN_CITY features)
4. **[P2] Consider adding a visual indicator** in the ownership view that marks controller-disputed regions (e.g., hatching or border highlight) so users understand that frontline differences exist without needing to toggle
