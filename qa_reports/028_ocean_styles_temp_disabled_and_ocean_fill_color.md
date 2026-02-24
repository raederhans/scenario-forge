# QA-028: Temporary Disable of Advanced Ocean Styles + Ocean Fill Color Picker

**Date:** 2026-02-24  
**Decision Type:** Temporary product/performance safeguard  
**Related:** `qa_reports/027_ocean_mask_fallback_and_visual_delta.md`

---

## 1) Decision Record

### Decision
- Temporarily disable advanced ocean presets:
  - `bathymetry_soft`
  - `bathymetry_contours`
  - `wave_hachure`
- Keep Ocean UI visible for future re-enable.
- Add configurable ocean base fill color (was fixed light blue).

### Why
- User-observed behavior: advanced presets had little visible difference but caused severe frame drops / interaction stutter.
- Short-term priority is stable interaction and clear UX.

### Scope
- Disabled at runtime and UI option level.
- No removal of controls or schema; this is reversible.

---

## 2) Code Changes

### `js/core/map_renderer.js`
- Added `OCEAN_ADVANCED_STYLES_ENABLED = false` kill-switch.
- `drawOceanStyle()` now early-returns when switch is off to avoid pattern generation/render overhead.
- Added `getOceanBaseFillColor()` and wired ocean base fill to `state.styleConfig.ocean.fillColor`.

### `js/core/state.js`
- Added ocean config default:
  - `styleConfig.ocean.fillColor = "#aadaff"`

### `js/ui/toolbar.js`
- Added ocean fill color binding (`#oceanFillColor`) to state + realtime render.
- Forced advanced presets to `flat` while switch is off.
- Disabled non-flat options in select at runtime.
- Disabled ocean texture sliders while advanced styles are off (UI retained, non-destructive).

### `index.html`
- Added Ocean Fill Color input (`#oceanFillColor`).
- Marked three advanced preset options as `disabled` (UI retained).
- Synced initial slider labels to current defaults.

### `js/ui/i18n.js`
- Added UI key: `lblOceanFillColor -> Fill Color`.

---

## 3) Verification Checklist

1. Open map page and confirm Ocean section is visible.
2. Ocean style select shows `Flat Blue` active; three advanced options visible but disabled.
3. Adjusting `Ocean Fill Color` immediately changes ocean base color.
4. Pan/zoom remains responsive without heavy stutter from ocean style pass.
5. Land painting behavior remains unchanged.

---

## 4) Re-enable Conditions (Future)

Re-enable advanced presets only after all are true:
1. Distinct visual delta between presets is clearly visible.
2. 30s pan/zoom test has no obvious FPS regression on baseline hardware.
3. Export PNG/JPG parity verified with on-screen rendering.
4. Ocean mask fallback + sparse ocean topology edge cases remain stable.
