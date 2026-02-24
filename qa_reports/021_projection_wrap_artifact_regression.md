# QA-021: Projection Wrap Artifact Regression (White/Blue Mask + Autofill Visual Failure)

**Date:** 2026-02-23  
**Environment:** `http://127.0.0.1:8000/` (Edge via Playwright MCP)  
**Related Reports:** `qa_reports/017_hybrid_renderer_diagnostic.md`, `qa_reports/020_canvas_color_pipeline_stability_fix.md`

---

## 1. Console Errors / Warnings

Observed repeatedly on home route and section checks:

- `404` for `data/europe_topology.highres.json`
- `[data_loader] Failed loading topology data/europe_topology.highres.json`
- `[data_loader] Primary topology too coarse (199). Using detailed fallback: data/europe_topology.json.bak (8305 features).`
- `404` for `favicon.ico` (noise, non-blocking)

Key implication:

- Runtime does **not** stay on `data/europe_topology.json` (199 features).  
  It force-switches to `data/europe_topology.json.bak` (8305 features) via fallback policy in `js/core/data_loader.js:17` and `js/core/data_loader.js:47`.

---

## 2. Network Failures / 4xx/5xx

Captured network summary:

- `GET /data/europe_topology.highres.json -> 404`
- `GET /data/europe_topology.json.bak -> 200`
- `GET /data/europe_topology.json -> 200`
- `GET /data/locales.json -> 200`
- `GET /data/hierarchy.json -> 200`

This confirms the active render dataset is the fallback `.bak`.

---

## 3. Screenshot Evidence

- Baseline white-mask symptom:  
  `.mcp-artifacts/screenshots/route-home-quick-20260222-203018.png`
- Debug `ARTIFACTS` mode (red giant overlays):  
  `.mcp-artifacts/screenshots/manual-artifacts-mode.png`
- After `Auto-Fill Countries` in `PROD` (blue giant mask):  
  `.mcp-artifacts/screenshots/manual-prod-after-autofill.png`
- After autofill while still in artifacts debug (for visibility):  
  `.mcp-artifacts/screenshots/manual-after-autofill.png`

Visual behavior is consistent with user report:

- A giant oval mask dominates canvas.
- Political subdivisions are compressed into a small cluster.
- Fill/autofill appears broken visually.

---

## 4. Reproduction Steps

1. Start local server and open `http://127.0.0.1:8000/`.
2. Load app in default `PROD` mode.
3. Observe giant white oval covering most of map canvas.
4. Click `Auto-Fill Countries`.
5. Observe giant oval turns blue while detailed regions remain tiny/localized; looks like autofill failure.
6. Switch debug mode to `ARTIFACTS` from debug UI (`sidebar.js`) and re-check map.
7. Giant red area appears, confirming giant projected feature overlays.

Targeted runtime state checks:

- Before autofill: `topoPolitical=8305`, `landFeatures=8305`, `colorsCount=0`.
- After autofill: `colorsCount=8305`, `uniqueColorCount=24`.

Conclusion:

- Autofill computation is running and writing colors.
- Main failure is render geometry dominance, not color assignment failure.

---

## 5. Minimal Patch Direction (Diagnosis + Fix Path)

### A) Immediate cause (frontend render path)

`js/core/map_renderer.js` currently culls only features meeting:

- width > `95%` **and** height > `95%` (`isGiantFeature`, `js/core/map_renderer.js:254`)
- and then skips culling for allowlisted country codes (`RU`, `CA`, `CN`, `US`, `AQ`, `ATA`) (`js/core/map_renderer.js:39`, `js/core/map_renderer.js:272`)

In current fallback dataset, three RU ADM2 features project to almost full width and large height, but are not filtered:

- `RU_RAY_50074027B10564453072266`
- `RU_RAY_50074027B19237962816289`
- `RU_RAY_50074027B45979560927325`

Measured projected bounds at runtime (`W=660, H=720`):

- each `w=608`, `h=295.92` (very large overlay geometry)

Because these are drawn in normal political loop (`js/core/map_renderer.js:669`), they overpaint most of map area in fallback color (white) or political color (blue after autofill).

### B) Why this reappeared

Loader fallback now promotes `.bak` whenever primary is below `minDetailedFeatures` (`js/core/data_loader.js:15`, `js/core/data_loader.js:47`), and `highres` is currently missing (`404`).  
So a stale/problematic detailed artifact path is automatically selected.

### C) Minimal code-level fix sequence

1. **Harden giant-feature predicate** in `js/core/map_renderer.js`:
   - add world-wrap detection using projected bbox aspect/coverage (not only `both >95%`).
   - include a width-dominant rule (e.g. near-full-width + substantial height) for wrap artifacts.
2. **Refine allowlist behavior**:
   - do not exempt all subdivisions solely by `cntr_code` (currently lets malformed RU ADM2 pass).
   - allowlist only true admin-0 shells or explicitly vetted IDs.
3. **Apply same filtered feature set to `fitProjection()`** (`js/core/map_renderer.js:1079`):
   - exclude known giant-wrap artifacts when fitting extent, otherwise map shrinks into tiny cluster.
4. **Loader safety guard** in `js/core/data_loader.js`:
   - do not silently prefer `.bak` in production path unless explicit opt-in / integrity check passes.
5. **Upstream data follow-up**:
   - review RU/UA processor dateline handling in `map_builder/processors/russia_ukraine.py:56` and topology patching pipeline to prevent these specific malformed `RU_RAY_*` geometries.

---

## Result

This is a **render artifact regression caused by giant wrap-like RU subdivision geometries in fallback topology** plus permissive culling/allowlist logic.  
Autofill logic itself is functioning; the visual layer is dominated by malformed giant features.
