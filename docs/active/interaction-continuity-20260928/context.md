# Context

## Current truth
Checkout: C:/Users/raede/.codex/worktrees/pan-zoom-integration/mapcreator. Branch codex/interaction-continuity-20260928, base 291b5aa2. Primary C:/Users/raede/Desktop/dev/mapcreator contains unrelated WIP and is untouched.

## Decisions and evidence
- 2026-09-28: prior TNO trace .runtime/browser/pan-zoom-integration/tno-integration-study.json shows 3 coverage-related previous-pixels events in each 300px pan, 1 in zoom-out; zoom-out first changed pixel about 1470ms. Existing layer slicing checks after whole passes; water max about 242ms. These are earlier diagnostic samples, not current performance guarantees.
- Baseline updateMap changed SVG before raster presentation; the implementation now records presented/target cameras separately and aligns the SVG group to the camera actually painted. Whole-scene navigation precedes fine cache preparation during interaction.
- CLI water analysis: task 5360af6de14745fd9ac5d5e8babe105a, Gemini 3.8 Flash High, read_only, parent_decides. Research completed. Continuation requested workspace_write but its actual session exposed only read tools; it made no edits. Native bounded execution took over; no CLI configuration or permissions were expanded.

## Live process ownership
Verification finished. The original TNO scenario preference was restored, owned browser tab 1 closed, and owned server session 91077 stopped with Ctrl-C. Server output remains at .runtime/tmp/interaction-continuity/server.log; final browser evidence is under .runtime/browser/interaction-continuity.

## Handoff and next step
All five scoped stages are implemented and validated; see task.md for evidence and remaining cold-recovery limits. Changes are uncommitted on codex/interaction-continuity-20260928. No push, merge or deployment was performed. Further performance work should target the separately observed chunk-promotion/border/other recovery tasks, not weaken coverage, scene, paint or resource identity checks.

## Cold recovery continuation completed
The three authorized follow-ups are complete: exact border arc transfer/source reuse, exact water path reuse across wrappers, and a rejected diagnostic water LOD candidate. Political LOD was not enabled because quality/adoption gates failed. First border registrations fell from447.6/387ms to122.9/111.8ms including packing; repeated zoom now uses policy updates. Full visual promotion remains about335ms. Raw evidence and limits are in task.md and .runtime/browser/cold-lod/.

CLI task84504ff9f100439dae1c2ec6fc79f1da used GLM-4.5-Air in read-only mode to locate metric fields. Router marked its unstructured final response partial; no edits were made and performance conclusions use direct source/browser evidence. Native agents implemented independently owned water-cache, border-worker and LOD-tool changes; parent integrated and ran browser checks.

Continuation cleanup: original TNO preference restored, owned browser tab2 closed and owned server session23213 stopped with Ctrl-C. No remaining live process is needed for this completed task. Primary checkout remains untouched; implementation is still local/uncommitted.

## Latest derived-cache continuation
First cold zoom missed because background complete color rebuilds replaced colors after the derived cache commit. Guarded color-baseline refresh now preserves valid deltas; visual coverage also reuses its synchronous prepared expectation. Separately, high-zoom scenario return could leave coarse water/Atlantropa evicted forever and navigation permanently unavailable. An internal ensureScenarioNavigationSourcesFn hook reuses the existing loader without selection/promotion changes; navigation owns returned inputs only until its raster job captures them and rejects obsolete requests.

Fresh local color/derived/visual samples changed56.1→2.1ms,310.4→126.6ms,469.7→271.6ms. These are phase samples with material run-to-run variation, not end-to-end performance promises. New-scene source reload/raster preparation still took1.7s/7.3s wall time. Final ready-navigation pan/reversal had20 interacting samples,0 unpresented frames,0 camera mismatches and converged to exact idle. Current code/tests and .runtime/browser/derived-recovery are authoritative. Keep the failed scene-recovery-drag trace distinct from the post-fix final-pan trace. See task.md for remaining first-interaction and full-rebuild limits.

Latest cleanup: TNO preference restored; owned browser tabs3/4 closed and owned server session96483 stopped with Ctrl-C. No test page or server remains needed. Work remains local and uncommitted in the integration checkout; primary checkout and production are untouched.

Latest continuation: first-window.md records early source/worker implementation, 73 Node and 5 Python checks, browser comparisons and remaining initial freeze. Next focus is navigation preparation before scene publication and scenario-promotion long tasks.

## Delivery verification ownership
Root is the sole integration and live-test owner. Workdir: pan-zoom-integration/mapcreator. Command: node --test over the changed/new .test.mjs inventory in .runtime/tmp/interaction-delivery/node-tests.txt. Log: .runtime/tmp/interaction-delivery/node-tests.log. No server or port. Success requires exit0 and no failed tests; stop and diagnose on failure. Then run the affected Python contracts. User authorized merge/push; primary checkout WIP remains untouched.

PR #182 first CI attempt passed Pages artifact construction and its 64 tests (one skipped), smoke E2E, scenario and transport checks. The adaptive executor then rejected an unmatched tools/build_water_display_lods.py. Added its canonical route and Shapely dependency classification; 117 metadata/portfolio tests pass and the full PR selector now reports no unmatched paths. Runtime code is unchanged.

Delivery follow-up: root owns remaining-checks.mjs (continues only unexecuted child-safe CI commands, no servers), logs under .runtime/tmp/interaction-delivery/. Exact export fixture now includes the real export guard and tests exceptional restoration. A bounded agent updates the water projection fixture; another checks stale source-contract expectations. Local dist mirror comparison requires a fresh artifact; root owns python tools/build_pages_dist.py --output-root .runtime/pages-delivery/dist, log .runtime/tmp/interaction-delivery/pages-build.log. No primary-checkout files or tracked dist are written.

Delivery follow-up complete: export guard fixture and exceptional restoration pass (9 tests); water/relief/cache fixtures pass (49); presented-frame Python contract passes (5); fresh Pages artifact and complete scenario chunk contract suite pass (88). The selected child-safe plan was executed across a fail-fast run and its remaining-command continuation; all observed failures were repaired and rerun. Verification core/commit runner tests pass (105), heavy dependency classification passes (80 classified modules), and full-PR selection has no unmatched paths. The offline water LOD route uses its own diagnostic identity so it does not expand the existing fixed scenario-heavy cohort. Fresh Pages artifact is 726.68 MiB under .runtime/pages-delivery/dist. No runtime implementation changed in these delivery repairs. PR: https://github.com/raederhans/scenario-forge/pull/182; final protected CI and merge receipt remain authoritative.
