# QA-020: Canvas Color Pipeline Stability Fix (Blue Wash + Ghosting)

**Date:** 2026-02-12  
**Primary File Modified:** `js/core/map_renderer.js`  
**Related Context:** `qa_reports/018_autofill_color_fix.md`, `qa_reports/019_topology_pipeline_fix.md`

---

## Context

Following QA-018 and QA-019, backend topology quality is now good (stable IDs + embedded neighbor graph).  
The remaining regressions were visual and frontend-side in the hybrid canvas renderer:

1. **"Blue Wash"**: after auto-fill, many regions looked uniformly blue.
2. **"Ghosting / mask fill"**: manual/custom paint sometimes appeared translucent or incorrect.

Selection and labels were still correct, indicating ID hit-testing itself was mostly intact.

---

## Audit Findings

### 1) Stable IDs were present and mostly wired correctly

- `data/europe_topology.json` political geometries: **8305**, missing `id`: **0**, missing country code: **0**.
- `getFeatureId()` and `autoFillMap()` were already using stable IDs, but robustness for mixed/legacy ID shapes was still weak.

### 2) Renderer accepted unsanitized color values

`state.colors[id]` was previously consumed directly by canvas fill/stroke logic.

If a color value was malformed (non-string, bad CSS value, `var(...)`, legacy import payload, etc.), canvas could ignore it and keep prior style state, causing visible artifacts:

- apparent blue dominance (reused previous valid color)
- translucent/mask-like fills (style state leakage)

### 3) Ocean visibility depended too much on geometry draw path

Ocean geometry draw existed, but there was no guaranteed full-canvas base fill each frame. If geometry draw failed/intermittently clipped, UI background/overlay could dominate the visual result.

---

## Changes Implemented

### `js/core/map_renderer.js`

1. **Hardened ID handling**
- `getFeatureId()` now uses nullish checks and string normalization (`String(...).trim()`), avoiding falsy ID edge cases.

2. **Added canvas color validation/sanitization utilities**
- `isProbablyCanvasColor()`
- `getSafeCanvasColor(value, fallback)`
- `sanitizeColorMap(input)`

Validation rejects non-strings, empty values, and `var(...)` tokens for canvas use.

3. **Made ocean rendering deterministic**
- At start of `drawCanvas()`, after reset/clear, renderer now paints a full-canvas ocean base with `#aadaff` via `fillRect(...)`.
- Then ocean geometry is drawn on top as before.

4. **Protected political fill loop from invalid colors**
- Feature fill now resolves with `getSafeCanvasColor(state.colors[id], LAND_FILL_COLOR)`.
- Prevents invalid map color entries from leaking stale canvas style.

5. **Protected border mesh color comparisons**
- `rebuildDynamicBorders()` now compares sanitized colors, reducing false border behavior from invalid color entries.

6. **Auto-fill compatibility + sanitization**
- `autoFillMap()` now supports both:
  - new return shape: `{ featureColors, countryColors }`
  - legacy flat map shape
- Every assigned auto-fill color is sanitized before writing to `nextColors`.
- Final `state.colors` assignment is sanitized.

7. **Manual paint + eyedropper hardening**
- Eyedropper now picks only valid canvas colors.
- Fill tool now sanitizes `state.selectedColor` before storing.

8. **State hydration sanitation**
- Sanitization applied in `initMap()` and `setMapData()` to clean preexisting/loaded color maps.

---

## Why This Fixes the Reported Symptoms

- **Blue wash:** invalid or legacy color values no longer propagate directly into canvas styling; fallback is explicit and stable.
- **Ghosting:** malformed fills no longer reuse prior canvas style state; fills resolve to valid colors only.
- **Ocean consistency:** light-blue ocean base is guaranteed every frame, independent of geometry draw anomalies.

---

## Notes vs QA-018 / QA-019

- QA-018 focused on ID/key matching and political color assignment strategy.
- QA-019 fixed topology-side adjacency and stable ID generation.
- **QA-020 is renderer hardening**: it assumes backend data is valid and prevents canvas style corruption from frontend color payload issues.

---

## Residual Risk / Follow-up

1. `sidebar.js` and `logic.js` can still write raw colors into `state.colors`. Renderer now sanitizes defensively, but upstream input validation could still be added for stricter guarantees.
2. Browser runtime validation is still required to visually confirm final UX in-app (terminal cannot execute the browser rendering path).

