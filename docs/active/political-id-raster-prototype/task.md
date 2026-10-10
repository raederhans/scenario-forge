# Status — stages 1–11

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
- [ ] Resolve any final-head CI findings, wait for every required check, and merge normally.
- [ ] Confirm the merge SHA's Pages deployment and hosted source/asset identity.
- [ ] Verify the published entry, assets, zoom quality and editing for all three scenarios.
- [ ] Report receipts, remaining limits and an executable follow-on plan; retain the worktree for evidence.

Implementation commit `9279755b87036bef7ce46f99b2f54dac7a84ffa2` is pushed. PR #218: https://github.com/raederhans/scenario-forge/pull/218 . Current root observes this PR's final-head checks; merge and deployment are pending.
