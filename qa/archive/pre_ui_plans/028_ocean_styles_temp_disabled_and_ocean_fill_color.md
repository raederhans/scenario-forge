# QA-028: Experimental Ocean Styles Gate + Ocean Fill Color Picker

**Date:** 2026-02-24  
**Decision Type:** Product/performance safeguard with explicit experiment gate  
**Related:** `./027_ocean_mask_fallback_and_visual_delta.md`

---

## 1) Decision Record

### Decision
- Keep advanced ocean presets behind an explicit experimental opt-in:
  - `bathymetry_soft`
  - `bathymetry_contours`
  - `wave_hachure`
- Keep Ocean UI visible and preserve `flat` as the default preset.
- Add configurable ocean base fill color (was fixed light blue).

### Why
- User-observed behavior: advanced presets had little visible difference but caused severe frame drops / interaction stutter.
- Default interaction should remain stable, but advanced presets still need a low-friction path for targeted testing.

### Scope
- Runtime gating now comes from `state.styleConfig.ocean.experimentalAdvancedStyles`.
- When the experiment is off, advanced presets and related sliders stay disabled and `flat` is enforced.
- No removal of controls or schema; this remains reversible.

---

## 2) Code Changes

### `js/core/map_renderer.js`
- `drawOceanStyle()` now early-returns when `state.styleConfig.ocean.experimentalAdvancedStyles` is off to avoid pattern generation/render overhead.
- Added `getOceanBaseFillColor()` and wired ocean base fill to `state.styleConfig.ocean.fillColor`.

### `js/core/state.js`
- Added ocean config default:
  - `styleConfig.ocean.fillColor = "#aadaff"`
  - `styleConfig.ocean.experimentalAdvancedStyles = false`

### `js/ui/toolbar.js`
- Added ocean fill color binding (`#oceanFillColor`) to state + realtime render.
- Added experimental styles toggle binding (`#oceanAdvancedStylesToggle`) to state + realtime render.
- Forced advanced presets to `flat` while the experiment is off.
- Disabled non-flat options in select at runtime until the experiment is enabled.
- Disabled ocean texture sliders while the experiment is off (UI retained, non-destructive).

### `index.html`
- Added Ocean Fill Color input (`#oceanFillColor`).
- Added Experimental Ocean Styles toggle (`#oceanAdvancedStylesToggle`).
- Synced initial slider labels to current defaults.

### `js/ui/i18n.js`
- Added UI key: `lblOceanFillColor -> Fill Color`.

---

## 3) Verification Checklist

1. Open map page and confirm Ocean section is visible.
2. With the experimental toggle off, Ocean style select shows `Flat Blue` active; three advanced options remain visible but disabled.
3. Adjusting `Ocean Fill Color` immediately changes ocean base color.
4. With the experimental toggle on, the three advanced presets become selectable and the three ocean texture sliders enable.
5. Pan/zoom remains responsive without heavy stutter from ocean style pass when the experiment is off.
6. Land painting behavior remains unchanged.

--- 

## 4) Re-enable Conditions (Future)

Re-enable advanced presets only after all are true:
1. Distinct visual delta between presets is clearly visible.
2. 30s pan/zoom test has no obvious FPS regression on baseline hardware.
3. Export PNG/JPG parity verified with on-screen rendering.
4. Ocean mask fallback + sparse ocean topology edge cases remain stable.
