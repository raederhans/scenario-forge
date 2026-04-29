# interaction_funnel direct root state write reduction

## Goal
- Reduce direct root state writes in `js/core/interaction_funnel.js`.
- Only touch the assigned files.
- Prioritize dense, low-risk clusters that can move onto existing or narrowly extended helpers.

## Scope
- `js/core/interaction_funnel.js`
- `js/core/state/ui_state.js`
- `js/core/state/dev_state.js`
- `js/core/state/strategic_overlay_state.js`

## Constraints
- Shared repo: preserve unrelated edits.
- No live tests.
- Deliver static verification guidance for main thread.
