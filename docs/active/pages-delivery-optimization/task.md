# Progress

- [x] Confirm current main and the previous rollout's failure/success evidence.
- [x] Isolate work on `codex/pages-delivery-optimization` in the existing managed worktree; preserve previous local closeout notes and primary WIP.
- [x] Correct sample startup queue ordering and cover lifecycle/error boundaries.
- [x] Optimize supported Pages workflow preparation and retain failure evidence.
- [x] Run relevant contracts and focused Pages runtime validation.
- [x] Complete review and report measured results and remaining delivery boundaries.

Workflow validation: 81 structural/admission tests passed, including executing the artifact verifier and loading the real release spec from the exact sparse file lists. Actionlint passed for both workflows. The source-built Pages artifact passed 65 startup-shell tests; its final lightweight URL extraction adds only one 684-byte module to the static main graph. Catalog routing has no unmatched paths or route gaps.

Performance check: baseline public release gate passed in 31.7s and 27.9s. Two slower iterations were rejected after runtime snapshots exposed old-scene warmup and unnecessary scene rearming. The final candidate passed in 28.4s (30.6s total), within the observed baseline range, with zero console/network issues and one attempt. This is bounded regression evidence, not a statistical startup-speed claim.

Final startup behavior: optional full interaction, scenario/localization hydration and context/contour warmup wait for the initial sample. Required import, detail/visual promotion, basic interaction and chunk readiness stay independent. Initial settlement is latched across later sample selections and cleared on owner reset. Scene changes retain the existing stale-task cancellation semantics; the project import recovery owns preparation and blocked/retry handling, including committed-with-warnings results. No new scene rearm is added.

All 63 startup/sample Node tests passed on the final source, along with two source-proof tests and four resource-graph checks against the final source-built artifact. The real public gate ran from the deploy job's sparse checkout layout. The main worktree's unrelated WIP and prior local closeout notes are preserved.

Both existing HOI4 1936 roundtrip-only browser cases passed against that artifact: normal save/reload and rejected imports (one worker, zero Playwright retries, 1.3 minutes total). The owned localhost server was stopped afterwards.

## Delivery

- [x] Integrate current main, push the scoped commit and create its PR.
- [x] Confirm required checks on the final PR head and merge through protected main.
- [x] Confirm the Pages deployment, public URL smoke and hosted preparation timings.

Main advanced to `a0476c9c` while local validation ran (PR #208, map-label typography/placement). It has no direct file overlap with this patch, but it changes renderer/build behavior. Final CI and deployment must validate the integrated revision; the timings above describe the isolated optimization on base `06d09474`.

Local delivery receipt: feature `c8c78232` and main integration `be93fd2e` are pushed in [PR #210](https://github.com/raederhans/scenario-forge/pull/210). Integrated source-proof and routing checks passed. Final PR verification is run `37278075260`; performance is `37278075240`. The prior task's two local closeout notes remain outside these commits.

Generated-artifact cleanup was rejected by automatic approval policy (`blocked by policy`); no alternative deletion was attempted. The three superseded local artifact roots remain alongside the accepted artifact and diagnostic logs.

Scoped daily-checkout installation is complete: all 13 feature file deltas applied with preimage backups; HEAD `f47b36f4` and selected index entries stayed unchanged. The 63 startup/sample tests, one local startup owner source proof and four workflow/admission tests passed there. Its whole-workspace `pr:plan` returns exit 2 for five other `vendor/fonts/` paths with unmatched routes; this scoped installation does not claim whole-workspace delivery readiness. The formal PR plan has no unmatched paths or route gaps.

Final integration: main advanced again to `e4462786` (PR #209). Review found four stale cache-owner proofs and one stale pure-reader/dependency contract. The merge commit `5c21316e` updates only reviewed fingerprints, explicitly registers the five new cache lifecycle methods and adds four exact identity-token read receipts. All 82 state-delegation tests and 82 relevant cache behavior tests pass. Source/action permissions remain unchanged. Daily-checkout renderer WIP differs from this integrated source; these upstream-specific contract changes are not blindly copied into it. The Pages feature and Demo diagnostic deltas remain installed and scoped separately.

The first PR run's Golden Demo exceeded the existing 180-second whole-test budget in the final TNO switch; the completed failure snapshot showed a settled TNO scene. The unchanged full Golden Demo passed locally (one worker, zero retries; about 86 seconds test). `eb726f24` adds its already-generated trace, screenshot and error-context to seven-day failure diagnostics. No timeout, assertion or retry setting changes.

Git fetch succeeded after a command-scoped DNS address selection, but Git push still failed with connection resets; no system settings changed. Root is preparing the exact local objects through GitHub's official Git database API, verifying each returned object/commit SHA before any non-force branch reference update. Evidence stays under `.runtime/reports/generated/pages-delivery-optimization/api-push/`. This is transfer recovery for the existing authorized branch, not a new branch or history rewrite.

Final PR head `5c21316e` passed all six required contexts. PR #210 merged at 2026-10-05T08:34:32Z as `a1be99c6`. Final PR verification run `37282864448` and performance run `37282864468` succeeded. Golden Demo took 155.741 seconds with retry 0; this is a passing result, not proof that whole-flow timing variance is eliminated. Pages deployment run `37284482788` is now validating the merged artifact and public URL.

Pages run `37284482788` completed successfully for `a1be99c6`: verify, artifact admission/build and deploy all passed. The actual hosted-URL smoke step passed in 77 seconds. The two optimized checkout steps took 1 second and 2 seconds, compared with the prior successful deployment's 124 seconds and 111 seconds (235 → 3 seconds for these preparation steps only). The live startup handoff and URL-parser scripts returned HTTP 200 and matched committed bytes exactly. These are separate facts from the bounded startup timing comparison; no general startup-speed multiplier or eliminated CI variance is claimed.

Daily installation remains intact under reverse apply-check for both scoped patches: 14 unique files, primary HEAD `f47b36f4` unchanged. Upstream renderer WIP differs from the integrated release, so upstream-only ownership proof repairs were not copied over it. Final receipts are `.runtime/reports/generated/pages-delivery-optimization/final-rollout.json`, `final-deployment-jobs.json`, and `hosted-source-verification.json`. Local closeout records and all recovery evidence remain retained.
