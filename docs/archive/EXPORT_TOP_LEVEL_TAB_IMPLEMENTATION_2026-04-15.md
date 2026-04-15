# EXPORT_TOP_LEVEL_TAB_IMPLEMENTATION_2026-04-15

## Plan
1. Recheck export-related DOM, state, tests, and support-surface leftovers in the new worktree.
2. Promote Export from Utilities into a standalone first-level Project section while preserving the overlay workbench entry.
3. Remove the legacy export popover path and align URL restore / focus restore to the new Export section.
4. Complete the workbench pieces already exposed in UI: real preview, text stack wiring, bake controls, and bake-pack multi-file export.
5. Update tests and docs to the new information architecture and verify targeted export behavior.
6. Run final review / bug sweep / first-principles simplification pass, then archive this tracker when complete.

## Progress
- [x] Step 1: Rechecked export-related DOM, state, tests, docs, and leftovers inside the worktree.
- [x] Step 2: Promoted Export into a standalone first-level Project section.
- [x] Step 3: Removed the legacy export popover path and realigned URL/focus restore to the Export section.
- [x] Step 4: Completed real preview, text stack wiring, bake controls, and bake-pack multi-file export.
- [x] Step 5: Updated docs and targeted contract tests. Static `node --check` passed. Python contract tests passed. Playwright e2e is currently blocked in this worktree because `@playwright/test` is not installed.
- [x] Step 6: Final review completed. Removed stale export popover copy, re-checked no old export support-surface chain remains, and confirmed the shorter architecture is: Project → Export section → existing overlay workbench.
