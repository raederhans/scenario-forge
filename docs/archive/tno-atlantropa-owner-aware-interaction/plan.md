# TNO Atlantropa Owner-Aware Interaction Plan

## Goal

Fix TNO Atlantropa startup yellow fill and unstable interactions by keeping `ATL` as the runtime/chunk bucket while using the real owner as the visible and interactive country identity.

## Steps

- [x] Add owner-aware interaction code in `map_renderer.js` for canvas hit, spatial hit, target resolution, country fill, and parent groups.
- [x] Exclude non-interactive Atlantropa helpers from political background merge.
- [x] Make `ATLISL_*` `boolean_weld` rows non-interactive in the TNO bundle builder and checked-in runtime data.
- [x] Extend existing contract tests for owner-aware hit results and TNO Atlantropa runtime invariants.
- [x] Run targeted renderer and bundle tests.
- [x] Run final review pass and archive this task folder.
