# Transport UI Review Fixes — 2026-04-15

## Goal
- Fix the reviewer-reported correctness regressions in the facility interaction path.

## Plan
1. Pass hover/highlight style through the facility point renderer without leaking outer-scope variables.
2. Make facility click gating respect real Appearance panel visibility.
3. Rebind selected/hovered facility entries to freshly projected hover entries after redraw.
4. Close stale facility card/highlight when the host transport surface is dismissed.
5. Fill the missing i18n keys used by transport summary, tooltips, and card fallbacks.
6. Re-run focused validation.

## Progress
- [x] Created implementation tracker.
- [x] Fixed facility renderer hover/highlight parameter flow.
- [x] Fixed facility click gating against hidden transport panels.
- [x] Fixed selected/hovered facility rebind after redraw.
- [x] Closed stale facility card/highlight when the host transport surface is dismissed.
- [x] Filled the missing transport i18n keys used by summary/tooltips/card fallbacks.
- [x] Ran targeted validation.
- [x] Archived this tracker.

## Notes
- Validation:
  - `node --check js/core/map_renderer.js`
  - `node --check js/ui/toolbar.js`
  - `node --check js/ui/i18n.js`
  - `python -m unittest tests.test_transport_facility_interactions_contract tests.test_ui_rework_plan03_support_transport_contract`
