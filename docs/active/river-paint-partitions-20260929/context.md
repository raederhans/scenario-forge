# Merge completion context

The user authorized completing the remaining safety-contract repairs, final-head
checks, normal PR #189 merge, independent main-worktree synchronization, and six
pilot-location acceptance in that order on 2026-09-30.

## Working baseline

- Integration: `codex/river-paint-partitions-p0-p2` at `3f27e311`, clean on entry.
- Independent main: `codex/main-sync-20260930` at `bfedc6b8`, clean on entry.
- Preserve the original primary checkout and every unrelated worktree.
- Prior functionality and repaired test evidence are in `implementation.md` and
  `.runtime/reports/generated/river-integration/`.
- Quick policy: 463/500 passed; main-source comparison: 470/500 passed.
- Latest PR run `36729930919`: fast and smoke failed; inspect both logs.

## Execution and acceptance

The main agent owns all writes, local live tests, CI supervision and Git changes.
Policy repairs must have source-level rationale and retain negative-mutation
tests; do not repin unknown source changes or broaden exemptions to turn CI green.
Use existing verification contracts and keep output beneath `.runtime`.
Long tests run serially where they share policy artifacts or browser ports.
Log commands and results here as each stage completes. Merge only with required
checks passing on the exact final head; verify the merge is in `origin/main`,
then fast-forward the independent main checkout and check six pilot locations.

## Current next step

Complete source-bound live admission for river helper results, action targets
and runtime capabilities, then run the quick policy suite. Commit the reviewed
repair and require all protected CI checks on that new head before merging
PR #189 normally. The older progress entries below are chronological evidence,
not the current process/ownership state.

## Active verification
Owner: this river thread. Command: node tools/run_p4_state_writer_policy_tests.mjs --quick, cwd river-paint-integration/mapcreator. Shared artifacts: .runtime/reports/generated/p4-state-actions/P4.0; log: .runtime/reports/generated/river-integration/policy-reviewed.log. Success: exit 0 with all selected tests passing; failure: retain logs and diagnose. No other policy runner active. Main/main-sync mutations deferred to the separate authorized integration thread during coordination.


Policy quick now passes 500/500 (policy-final.log). New negative case rejects changed river clear helper even when a caller drops dependency metadata.
Browser owner: this thread; command node node_modules/@playwright/test/cli.js test tests/e2e/sample_guide_deeplink.spec.js --grep 'opens export from the TNO' --workers=1 --retries=0. cwd integration worktree; localhost port 8007; output .runtime/tests/playwright; log .runtime/reports/generated/river-integration/tno-smoke.log. Stop at test exit; retain evidence on failure.


TNO focused Golden Demo passed locally (1/1, 59.2s); cloud pending failure is not yet explained. River browser owner remains this thread, port 8007, same output directory; command now targets tests/e2e/river_paint.spec.js, workers=1 retries=0; log pilot-six.log. Both existing cases must pass, including 31 cell colors across six parent canvases.


main-sync-20260930 was archived through the app after clean status and 0/0 origin/main ancestry were confirmed. The separate authorized cleanup thread now owns primary main synchronization. River worktree remains active.
Full policy diagnostic owner: this thread; command node tools/check_state_writer_policy.mjs --json-out .runtime/reports/generated/river-integration/policy-full.json; log policy-full.log. It shares no browser resource; stop on exit and report any remaining historical proof gap.


The final quick suite uses only its P4.0 TAP output and runs alongside the full checker (separate JSON/proof artifacts, no browser/port ownership overlap). Command: node tools/run_p4_state_writer_policy_tests.mjs --quick; log policy-final-complete.log. New deep reader discovery regression and activation isolation regression are included.

Final quick result: 502/502 passed, including deep conservative reader discovery
and all live action-module source/non-target checks. The separate activation/river
suite passed 36/36; raster behavior passed 21/21.
Native browser acceptance passed for 31 cells across all six pilot parents, and
the real-map click/undo/import/export case passed. Import-graph validation passed
for 69 specs. Logs remain under the river-integration runtime report directory.

The other authorized cleanup thread has finished synchronizing primary main and
released its temporary main/merge hold. Its uncommitted primary registry receipt
must be preserved. After merge, fast-forward this existing river worktree to
origin/main to provide the independent synchronized checkout without recreating
the archived redundant main-sync worktree.

The full historical scan stopped at hover successor-source drift after 17m29s.
That diagnostic and a separately discovered missing river action registration
were repaired and covered by the quick suite. All action modules now pass the
isolated preflight. The next full diagnostic must use the committed repair head;
do not characterize the terminated scan as a historical-proof pass.

## Resumed completion (2026-10-01)

Published repair head: `9c1d46710cb9cd1cd3ff6aca00cfd5151e18a50c`.
Final-head fast, Quick Fill, scenario, transport and perf checks passed; smoke
failed at the sample-import readiness assertion. Slow-CPU reproduction confirmed
the default TNO scene can become idle before the sample import completes.
Golden Demo now waits for the actual import via the existing helper; all budgets
are unchanged. A deterministic wrapper delaying both sample JSON responses by
35 seconds passed the entire Golden Demo. The broader CPU-throttle run exhausted
the total test budget and is not counted as passing.

The post-interruption full scan was safely stopped once missing canonical river
bindings were independently established; another old-snapshot checker run could
not pass. The official P4.4 policy builder used explicit previous-policy revision
`3fd7478a232132812d87c782e2504f6f594bc9c3` without baseline refresh, then exited 1
on a retired navigation state-key read. It wrote no policy snapshot. The read was
removed and 16 navigation tests passed. Log:
`.runtime/reports/generated/river-integration/policy-generate.log`.

No full policy producer is active. The verification catalog places full policy
proof in the heavy/main-thread/full profile, deferred by PR fast. Preserve the
known historical gap and frozen snapshot; do not substitute quick evidence for
full proof. The current work is narrowly scoped live river admission.

Execution ownership: `river_live_admission` owns the four existing policy tool
modules and focused policy tests, including the parent's borrowed action-result
patch. It may run short targeted tests, but no full generator/checker or Git
mutations. The main agent owns all other files, CI, browser tests, commits and
merge/sync. Do not run the final quick suite until the delegate hands back its
files and test ownership.

A fresh primary-checkout read found additional unrelated country-label work,
besides the registry receipt, and a separate `scenario-geometry-repair` worktree.
Both are outside this task. Primary main remains at `bfedc6b8`; preserve all of
its tracked and untracked work. Synchronize only the river integration checkout.

Live admission handoff is complete; the main agent again owns every file and
test. All five action targets pass grant validation, with their assignments
preserved. The four owner bindings pass exact current-source/inventory evidence,
with raw unsupported/ambiguous findings retained. Focused tests passed 218/218;
the final official quick runner passed 518/518 (exit 0, 16.43s), logged at
`.runtime/reports/generated/river-integration/policy-live-final.log`.
No local test or full-policy producer remains active. Next: commit, push and
supervise exact-head protected CI before normal merge and independent sync.
