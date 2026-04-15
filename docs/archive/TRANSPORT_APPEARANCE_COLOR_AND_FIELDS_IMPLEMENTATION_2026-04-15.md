# Transport Appearance Color + Fields Implementation — 2026-04-15

## Goal
- Add per-family primary color controls for Airport and Port in Appearance > Transport.
- Keep the new color controls scoped to main-map transport rendering only.
- Expand facility info cards with a compact default field set plus an in-card “more fields” toggle.

## Plan
1. Extend transport overview style config with `primaryColor` for airport and port.
2. Add Airport / Port primary color controls to the Appearance panel and wire them to render + persistence.
3. Refactor airport / port visual style derivation so color comes from `primaryColor` and strength only affects intensity/size.
4. Refactor facility info card body generation to support compact rows + expandable extra rows.
5. Add targeted contract tests and run focused validation.

## Progress
- [x] Created implementation tracker.
- [x] Added transportOverview primaryColor config + persistence normalization.
- [x] Added Appearance panel color pickers and runtime bindings.
- [x] Updated airport/port visual style derivation.
- [x] Added expandable extra facility fields.
- [x] Ran targeted validation.
- [x] Archived this tracker.

## Notes
- This task builds on the existing uncommitted facility hover/info-card work from 2026-04-14.
- Workbench preview/inspector stays unchanged in this wave.
- Validation:
  - `node --check js/core/state.js`
  - `node --check js/ui/toolbar.js`
  - `node --check js/core/map_renderer.js`
  - `node --check js/ui/i18n.js`
  - `python -m unittest tests.test_transport_facility_interactions_contract tests.test_ui_rework_plan03_support_transport_contract`

