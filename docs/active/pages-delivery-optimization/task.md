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

- [ ] Integrate current main, push the scoped commit and create its PR.
- [ ] Confirm required checks on the final PR head and merge through protected main.
- [ ] Confirm the Pages deployment, public URL smoke and hosted preparation timings.

Main advanced to `a0476c9c` while local validation ran (PR #208, map-label typography/placement). It has no direct file overlap with this patch, but it changes renderer/build behavior. Final CI and deployment must validate the integrated revision; the timings above describe the isolated optimization on base `06d09474`.
