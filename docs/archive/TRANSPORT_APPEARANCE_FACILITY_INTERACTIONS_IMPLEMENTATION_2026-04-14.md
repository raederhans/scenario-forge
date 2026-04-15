# Transport Appearance Facility Interactions Implementation — 2026-04-14

## Goal
- Add low-risk main-map interactions for airport and port markers in the Appearance > Transport panel path.
- Keep existing land/water/special editing flow intact outside precise facility hits.

## Plan
1. Add facility hover cache and tooltip/pointer handling in `js/core/map_renderer.js`.
2. Add lightweight facility hover highlight and a pinned info card with a zoom action.
3. Add airport/port filtered counts to transport summary badges in `js/ui/toolbar.js`.
4. Run targeted validation, then archive this tracker.

## Progress
- [x] Created implementation tracker.
- [x] Added facility hover cache, tooltip, pointer, and highlight.
- [x] Added facility click info card and zoom action.
- [x] Added transport summary counts.
- [x] Ran targeted validation.
- [x] Archived this tracker.

## Notes
- Main map transport data currently loads from `js/core/data_loader.js` direct GeoJSON URLs, not the workbench manifest variant pipeline.
- Tooltip will stay non-interactive; detailed actions live in a separate card.
- Validation:
  - `python -m unittest tests.test_transport_facility_interactions_contract tests.test_ui_rework_plan03_support_transport_contract`
  - `node --check js/core/map_renderer.js`
  - `node --check js/ui/toolbar.js`
  - `node --check js/main.js`
  - `node --check js/core/state.js`
  - `tests/e2e/ui_rework_support_transport_hardening.spec.js` rerun: 7 passed, 1 existing unrelated failure in compare-status zh copy (`family` vs `家族`)

