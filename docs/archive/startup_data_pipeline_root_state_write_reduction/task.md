# startup_data_pipeline direct root state write reduction

## Goal
- Reduce direct root state writes in `js/bootstrap/startup_data_pipeline.js`.
- Prioritize the safest dense clusters under city/localization/context layer/palette/releasable startup hydration.
- Keep the diff narrow and avoid new architecture.

## Scope
- `js/bootstrap/startup_data_pipeline.js`
- `js/core/state/content_state.js`
- `js/core/state/color_state.js`
- `js/core/state_catalog.js`

## Constraints
- Shared repo: preserve unrelated edits.
- No live tests in this task.
- Final handoff should name changed files, removed write clusters, and suggested main-thread verification.