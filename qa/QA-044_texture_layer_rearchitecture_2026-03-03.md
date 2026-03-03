# QA-044 Texture Layer Rearchitecture

## Summary

This slice replaced the legacy CSS texture overlay with a canvas-rendered texture pipeline.

Key outcomes:

- `Clean` is now actually clean at the map level.
- `Old Paper` is rendered inside the globe on the main canvas instead of via a DOM background layer.
- `Grid` and `Canvas` were replaced with differentiated projected modes:
  - `Graticule`
  - `Draft Grid`
- Texture settings now persist in project save/load and participate in history snapshots.
- Snapshot export now includes texture because the effect is rendered onto the main map canvas.

## Files Changed

- `js/core/state.js`
- `js/core/file_manager.js`
- `js/core/sovereignty_manager.js`
- `js/core/map_renderer.js`
- `js/ui/toolbar.js`
- `js/ui/sidebar.js`
- `js/ui/i18n.js`
- `index.html`
- `css/style.css`
- `vendor/textures/paper_vintage_01.svg`
- `vendor/textures/README.md`

## Implementation Notes

### Texture State

Added `styleConfig.texture` with normalized defaults and legacy mode aliases:

- `canvas -> draft_grid`
- `grid -> graticule`

Project schema version is now `6`.

### Rendering

`drawCanvas()` now draws textures after land fill and before context layers.

Modes:

- `paper`: warm wash + tiled paper asset + procedural grain/wear + vignette
- `graticule`: projected major/minor latitude/longitude lines with major labels
- `draft_grid`: rotated projected grid with independent controls

### UI

Texture controls now expose:

- common opacity
- `Old Paper`: scale, warmth, grain, wear
- `Graticule`: major step, minor step, label step
- `Draft Grid`: major step, minor step, longitude offset, latitude tilt, roll

### Persistence

Texture settings are now:

- exported in project JSON
- restored on import
- normalized on load
- included in history state snapshots

## Validation

### Static

- `node --check js/core/state.js`
- `node --check js/core/file_manager.js`
- `node --check js/core/sovereignty_manager.js`
- `node --check js/ui/sidebar.js`
- `node --check js/ui/toolbar.js`
- `node --check js/core/map_renderer.js`

All passed.

### Browser

Validated in local browser against `http://127.0.0.1:8000/`.

Observed:

- `Clean`, `Old Paper`, `Draft Grid`, and `Graticule` all render as distinct modes.
- `Draft Grid` and `Graticule` follow the globe projection rather than screen-space tiling.
- `styleConfig.texture` updates in runtime state when controls change.
- project export serializes texture state with `schemaVersion = 6`.

Artifacts:

- `.mcp-artifacts/texture-mode-none.png`
- `.mcp-artifacts/texture-mode-paper-v2.png`
- `.mcp-artifacts/texture-mode-draft_grid.png`
- `.mcp-artifacts/texture-mode-graticule.png`

## Known Gaps

- New texture control labels currently rely on English fallback unless localized UI strings are added to the locale data.
- `Old Paper` is intentionally conservative enough to preserve map readability; future polish can push the texture further if a more stylized atlas look is desired.
