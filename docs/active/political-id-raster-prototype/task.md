# Status — stages 1–11

## 2026-10-10 asset recovery and release regression

The user authorizes bounded recovery after consecutive asset timeouts, regression checks for all three scenarios, PR, protected merge and Pages deployment. Work continues only in the owned integration worktree on `codex/political-raster-recovery-20261010`, based on `a9ee29072`; primary architecture WIP and earlier evidence remain untouched.

- [x] Reproduce the permanent timeout bypass and establish the recovery boundary.
- [x] Add demand-driven cooldown probing, explicit timeout/error diagnostics and focused regression cases.
- [x] Wire the real three-scenario recovery path into artifact and deployed release checks.
- [x] Verify local behavior, artifact delivery and final-head required CI; create and merge the scoped PR.
- [x] Confirm the exact Pages deployment, hosted recovery and editing/quality; report remaining limits.

The user's delayed clarification also authorizes picking and continuous brush optimization in this batch. PR219 merged but its new artifact release gate stopped deployment (1939 pixel comparison, TNO DPR2 total duration); preserve that evidence and repair the gate without relaxing quality/deadlines. Continue on codex/political-raster-interaction-20261010, based on the merged source. Public deployment remains the previous version until a successful follow-up release. The candidate now bounds idle recovery to two probes per view, preserves canonical first-containing picks, coalesces native brush feedback into an exact final frame, and expands release coverage to five cases (separate DPR2 TNO recovery and continuous editing). The full combined TNO browser check passed, but exceeded the release case total budget, so the cases are split without extending deadlines.

- [x] Repair full-frame readiness and remove redundant cold setup in the release verifier; prove the three scenarios again.
- [x] Measure fixed ON/OFF point selection, real recolor and brush paths before changing product behavior.
- [x] Improve verified picking and repeated brush work while preserving exact IDs, priority, color sets and history.
- [x] PR #220 final head `52a59202` passed all six required checks and merged normally as `181a973fc` at 14:37:16 UTC; other worktrees remain untouched.
- [x] Deliver the bounded, same-page release phases after run38060336698 exposed total-case timeout overruns; preserve all quality, recovery and editing assertions.
- [x] All nine local stages passed with full tracing; sparse release checkout discovers all10 cases. Asset and interaction behavior and exact pixels remain covered, with bounded cleanup and no owned server left running.
- [x] Validate and deliver the follow-up PR through required checks, merge and exact hosted verification.

Final receipt: PR #221 head601d007577ec86eb01ea54f756de418314ef3875 passed all six required contexts and merged as74df7c10067b5dc39542f0893734b4282fb87b2f. Pages run38063247476 and deployment6983018421 succeeded at15:45:27UTC, including10 artifact and10 hosted checks. All three published scenarios recovered after the injected failed first probe, matched native100%/130% and edited pixels exactly, and passed real paint/41-step brush undo-redo. Seven hosted modules and all three manifests match the release; sampled compressed assets validate. Runtime gates use the same page through recovery and editing. Product speedup remains limited to earlier feedback/lower containment cost; full workload and post-edit navigation still need improvement. Final report: `.runtime/reports/generated/raster-interaction/release-report.zh-CN.md`. All task-owned test/server/watch processes are closed; keep this worktree for evidence. These final task-record updates are local handoff metadata, not additional product changes.

- [x] Stage 1: isolated baseline at 98425dcc; fixture and measurement contract fixed.
- [x] Stage 1: real sample baseline measurements captured.
- [x] Stage 2: derived geometry/palette source and behavior tests.
- [x] Stage 3: local ID/coverage tile renderer and browser harness.
- [x] Stage 3: real browser quality, palette/undo, cold/warm cost and memory report.
- [x] Stages 1–3: focused verification, PR planning and final scope review.
- [x] Stages 1–3: close owned browser/server processes; retain report and screenshots.
- [x] Stage 4: opt-in main-app political fine pass, single producer, complete-frame and latest-palette guards, existing vector fallback.
- [x] Stage 4: preserve canonical editing, picking, river partition ordering, project persistence and export.
- [x] Stage 5: projected-space multilevel tiles, cancellable Worker, bounded CPU LRU and GPU admission.
- [x] Stage 5: local old/new bounds invalidation, complete contributors, stable IDs and selective GPU retention.
- [x] Stage 6: actual app edit/undo/redo/save/reimport/export and all three scenarios.
- [x] Stage 6: corrected native baseline, cold/warm measurements, pan/zoom reuse, context loss and unsupported GPU.
- [x] Stage 6: 135 Node tests and 8 Python boundary tests, architecture/import graph/route checks.
- [x] Stage 6 decision: retain opt-in; measured fractional-scale quality does not meet the provisional gate.
- [x] Stages 4–6: final PR plan and scope review; close owned browser/server and confirm port released.

User permits a small raster quality reduction. The six fixed-view prototype cases
passed the separate approximate-quality criteria. The new runtime fractional-scale
and full TNO views exceed that gate, so `political_id_raster=1` is required and
default rendering stays unchanged. See results.md for measurements and limits.

## Authorized follow-on: stages 7–11

- [x] 7: compare actual-app native partial repaint and ID rendering; attribute fractional-scale quality loss.
- [x] 8: bounded projected-path reuse, measured gutter policy and stable display coordinates.
- [x] 9: versioned prebuilt tile codec, reproducible pilot builder and stable geometry/ordering identities.
- [x] 10: conservative CPU interior picking with exact existing selection fallback.
- [x] 11: asset-first tile loading, bounded persistent cache, revisit/failure/integration evidence.
- [x] Focused behavior, browser and repository routing checks; update results and close owned processes.

No commits, push, merge or deployment. Default enablement remains evidence gated.

## Authorized review and delivery

- [x] Inspect current main/worktree ownership and protected merge requirements.
- [x] Review runtime assets and Worker/GPU boundaries; fix and re-review two P2 findings.
- [x] Add regressions for immediate disposal and validly encoded assets with wrong size/origin.
- [x] Complete scope review and direct checks: 200 renderer tests, 118 metadata tests, 13 Python boundaries, architecture and Pages source references.
- [x] Split the new local test route into bounded groups; preserve the existing whole-workspace edit-budget rejection as a planning limitation.
- [x] Refresh current-source proof fingerprints after CI identified drift; 85 authority/borrowed-effect contract tests pass without changing historical permissions or frozen baselines.

Remote delivery: commit and push this feature branch, then use its GitHub PR for final-head required checks and merge. Verify the merge commit on remote main before reporting completion. Git receipts are the authority for this phase; this checklist records preparation, not future CI success. The worktree remains available for its ignored pilot and browser evidence.

The preceding no-push statement records the stages 7–11 handoff; the latest user request authorizes this delivery phase. Deployment verification is separate.

## 2026-10-10 integration

- [x] Isolate worktree at published base; leave other chat WIP untouched.
- [x] Trial preference, actual state diagnostics, startup preparation and timings.
- [x] Reproducible compressed asset builder, manifests, catalog and Pages checks.
- [x] Fractional zoom exact refinement with cancellation and bounded scheduling.
- [x] Three-scenario browser/targeted regression and artifact validation.
- [x] Results, limitations and clean process handoff.

Local items 1–3 are complete; see integration-results.zh-CN.md. Six Pages-artifact browser cases and saved-preference Chinese startup passed. TNO DPR 2 retained one observed timeout/Worker fallback; no blanket zero-build or speedup claim. No commit, push, PR, merge or production deployment in this integration turn. Owned browser contexts and both servers are closed.

## Authorized production delivery — 2026-10-10

The user now authorizes committing this batch, creating a PR, merging after required checks, deploying Pages, and verifying all three published scenarios. Earlier no-deployment statements describe the preceding implementation turn.

- [x] Refresh remote main and ownership; preserve primary architecture work and prototype evidence.
- [x] Commit only this worktree's scoped changes and push the feature branch; attach the PR.
- [x] Resolve any final-head CI findings, wait for every required check, and merge normally.
- [x] Confirm the merge SHA's Pages deployment and hosted source/asset identity.
- [x] Verify the published entry, assets, zoom quality and editing for all three scenarios.
- [x] Report receipts, remaining limits and an executable follow-on plan; retain the worktree for evidence.

PR #218 (https://github.com/raederhans/scenario-forge/pull/218) merged final head `dcda61dafb2db64b8136f5766716212065408ac0` after 18 checks and all six required gates succeeded (one optional observation skipped). Merge commit: `a9ee29072020fad200cd52b10200e5e8de51391c`, 2026-10-10 12:03:52 UTC. Pages run 38050609688 and deployment 6980551347 succeeded for this exact merge at 12:15:52 UTC, including hosted smoke.

Published verification: five scenario/DPR cases passed initially; TNO DPR 2 hit the existing consecutive asset timeout breaker and failed the strict asset-error assertion. The identical single-case recheck passed without code, assertion or deadline changes. Across the six passing results, both zoom levels match native settled political pixels exactly and real fill/undo/redo pass. The saved-preference Chinese TNO startup and UI zoom input also pass. Keep the original failed report; intermittent asset timeout recovery is the first follow-on item, not a claim of a fully stable cold path or overall speedup. Release report and remaining plan: `.runtime/reports/generated/raster-release/release-report.zh-CN.md` and `remaining-plan.zh-CN.md`. All owned test browsers/processes closed; retain this worktree for evidence.
# Follow-on authorized 2026-10-11

- [x] Reproduce post-edit navigation cost against published74df7c; separate first feedback, exact completion, navigation and full workload.
- [x] Implement the smallest supported improvement with exact pixels, selection and history preserved.
- [x] Validate representative viewport/DPR cold/revisit behavior and bounded retained memory; keep default-off. Preserve the failed large TNO native-settle case as an explicit limitation.
- [ ] Complete scoped checks, PR, final-head required checks, normal merge and exact Pages/hosted verification.
