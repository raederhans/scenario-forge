# PR delivery lanes

Authorized 2026-10-05: implement the first three recommendations in order.

1. Add a read-only delivery plan using the existing PR policy and verification catalog. Distinguish committed changes, pending workspace changes, local verification, CI obligations and missing coverage. Link concise contributor guidance from AGENTS and both READMEs.
2. Separate ordinary documentation/UI edits from shared runtime, data and verification changes. Preserve fail-closed coverage and stable required check names; keep diagnostic performance observations outside the low-risk merge gate.
3. Separate fast Pages source/entry/reference checks from full artifact rebuilding. Keep full builds for delivery/data/dependency/control-plane changes and final release artifacts.

Acceptance: behavioral planner tests, negative coverage/unknown-path cases, executable workflow aggregator tests, fast Pages checker fixtures, repository selector/catalog consistency, and appropriate workflow validation. Remote timing improvement requires a real hosted run and must not be claimed from local tests.

Non-goals: modify branch protection, enable direct main pushes, deploy, weaken performance sampling/thresholds, repair unrelated Nightly failures, or modify the dirty primary checkout.

Base: origin/main 475bbbd81a37bdc3deec842769354b6a38b12c5b. All implementation in the managed pr-delivery-lanes worktree, branch codex/pr-delivery-lanes.

## Authorized rollout extension, 2026-10-05

The user requested step 4 and formal rollout to both the local development repository and GitHub. Root owns commit, push, PR merge and deployment verification. Remove duplicated post-merge Scenario/Transport full runs while retaining required PR names and manual full audit entry points. Preserve existing strict protection unless the user chooses a different merge policy. Keep label-driven reclassification and fail-closed required checks.

Rollout acceptance: target tests and workflow validation; pushed PR and final required checks; protected merge and Pages deployment result; local installation of the same delivery system with all unrelated WIP preserved. The primary checkout is concurrently used, so install only scoped changes instead of stashing/resetting or synchronizing unrelated product files.
