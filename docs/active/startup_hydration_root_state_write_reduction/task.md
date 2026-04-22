# startup_hydration direct root state write reduction

## Goal
- Reduce direct root state writes in `js/core/scenario/startup_hydration.js`.
- Prioritize these clusters first:
  - runtime topology / optional layer hydrate
  - readonly reset for hydration gate
  - hydration gate state commit
- Keep design small and stay inside the assigned write scope.

## Scope
- `js/core/scenario/startup_hydration.js`
- `js/core/state/scenario_runtime_state.js`
- `js/core/state/boot_state.js`
- `js/core/state_catalog.js`

## Constraints
- Shared repo: preserve unrelated edits.
- No live tests.
- Final handoff should include suggested main-thread verification.
