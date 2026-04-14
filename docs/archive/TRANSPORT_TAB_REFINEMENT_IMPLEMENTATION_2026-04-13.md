# TRANSPORT TAB REFINEMENT IMPLEMENTATION 2026-04-13

## Goal
- Refine the new top-level `Appearance > Transport` tab to match existing Appearance UX.
- Restore consistent inner spacing, make family sections collapsed by default, replace vague presets with clearer controls.
- Keep startup bundle / startup support / scenario chunk publish chain untouched.
- Start real Rail/Road coarse integration prep without borrowing workbench data.

## Checklist
- [x] Start implementation tracker
- [x] Audit current Transport tab structure, CSS, state, and renderer behavior
- [x] Fix panel/body spacing and family collapse structure
- [x] Replace vague visual preset with clearer control model and linked scope behavior
- [x] Remove conflicting transport warmup behavior
- [x] Add Airport/Port zoom-based reveal
- [x] Prepare Rail/Road coarse runtime/data skeleton
- [x] Run validation and final review
- [x] Archive this doc when complete

## Progress
- 2026-04-13 22:16: Started second-round implementation after refining plan from live feedback.
- 2026-04-13 22:28: Rebuilt `Appearance > Transport` to use local panel padding plus `details + summary` family sections, all collapsed by default.
- 2026-04-13 22:34: Replaced Airport/Port visual preset dropdowns with `Visual Strength` and `Coverage Reach`, added linked/manual scope behavior with live readouts.
- 2026-04-13 22:40: Moved Transport truth back to `showTransport + styleConfig.transportOverview`, keeping UI state out of the business state path.
- 2026-04-13 22:44: Added zoom-based reveal for Airport/Port and removed coarse transport post-ready warmup from `main.js`.
- 2026-04-13 22:47: Kept Rail/Road in `transportOverview` schema only as UI/data-contract placeholders and explicitly avoided half-connecting project save/load or runtime loaders before real data exists.
- 2026-04-13 22:53: Validation passed with `node --check` on touched JS files, module import smoke for `state/map_renderer/toolbar`, and a short Playwright smoke confirming `Transport` tab exists, Airport/Port sections are collapsed by default, and no browser errors surfaced during initial boot.

