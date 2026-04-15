# Transport UI Self Review And Polish — 2026-04-15

## Goal
- Fix the current hover/click affordance mismatch for airport and port facility markers.
- Polish the facility info card so it feels more native to the existing shell instead of like a separate debug popup.

## Plan
1. Align pointer affordance with actual click availability for facility markers.
2. Refine the facility card hierarchy, spacing, action emphasis, and field ordering.
3. Keep the change small and local to the existing transport appearance + facility card path.
4. Run targeted validation and archive this tracker.

## Progress
- [x] Created implementation tracker.
- [x] Fixed hover/click consistency.
- [x] Polished facility card UI and field hierarchy.
- [x] Ran targeted validation.
- [x] Archived this tracker.

## Notes
- This wave should avoid widening click interception over the land paint path.
- Prefer a lighter, calmer card treatment and clearer primary/secondary action hierarchy.
- Validation:
  - `node --check js/core/map_renderer.js`
  - `node --check js/ui/toolbar.js`
  - `node --check js/ui/i18n.js`
  - `python -m unittest tests.test_transport_facility_interactions_contract tests.test_ui_rework_plan03_support_transport_contract`
- Browser automation self-review was attempted against the local dev server, but the ad-hoc Playwright audit script did not complete cleanly in this shell. Static UI review + code-path review were used for this pass.

