# Runtime simplification progress

- [x] Preserve the original checkout and isolate work from current remote main.
- [x] Batch 1: correct false-ready resources and malformed diagnostics success; remove unused traces and duplicate normalization.
- [x] Batch 2: use canonical paint state throughout runtime/history/save; retire disabled ownership editing while retaining read-only references.
- [x] Batch 3: simplify renderer event binding and runtime hooks through existing owners.
- [x] Batch 4: delete nine unused or disconnected modules and update affected tests/build/catalog entries.
- [x] Targeted runtime, browser, build, import graph and catalog verification.
- [x] Complete exact reader/action proofs and capability-retirement regression coverage.
- [x] Classify full-policy failures and apply the user's explicit instruction to relax this additional merge prerequisite.
- [ ] Commit, push, pass protected-branch checks, and merge the authorized PR.

## Implementation and evidence

Production JavaScript adds 248 and removes 6,098 lines: a net reduction of 5,850 lines. This is source simplification, not a measured performance improvement. Legacy color input conversion remains at the project import boundary. Async request identity, import atomicity, cache invalidation and scenario reference consumers are preserved.

The final closeout also removed stale view-state reads and corrected export-preview/border-worker cache identities to read `renderTransactionDiagnostics.scenarioApplyEpoch`. Their target suites pass 30/30, with context-bar tests 6/6.

Focused overlapping suites cover input handling (34), trace owners (25), import/startup/export (97), paint/brush/quick-fill (40), history (21), atomicity/palette/reference consumers (63), event/import orchestration (36), hook lifecycle and startup (54), and toolbar sources (55). Continuation proof suites pass action-delegation 73 plus three new action receipt cases, borrowed effects 64, overlay/water 45, identity/worker/decoder 23, historical authority replay 1, and the final retirement suite 11.

The retirement contract records 53 exact authority retirements or reconciliations. Ten reconcile observations already stale in the accepted baseline and are not claimed as code removed in this batch. Eight existing ledger entries retain their full previous action proofs. The surviving `showUrban` action uses the existing exact migration contract for its shifted callback ordinal. Negative tests reject returning writes/calls, altered old proofs and terminal actions that do not match their original proof. Historical key ownership is confined to frozen-source replay; current state ownership does not restore retired keys.

The real-map paint/erase/undo/redo/reload browser case passed. That browser run preceded the final epoch/context-bar changes, which have the target coverage above. The earlier Pages artifact passed startup checks and covered 456 modules with no unresolved imports or multi-module cycles; it also predates the final source changes. Final artifact and smoke evidence must come from the PR head's required checks.

## Delivery

Delivery PR: https://github.com/raederhans/scenario-forge/pull/179. The first CI run exposed one Quick Fill assertion still expecting retired ownership-mode gating. Its obsolete fixture callback and assertion were removed; the complete Quick Fill node suite passes 56/56, and the existing state-write allowlist check passes (118 projected files, 67 observed direct writers). Required checks and the merge receipt remain available on the PR.

All changes are isolated in the managed `runtime-simplification` worktree. The original checkout's mixed WIP is not an integration target. Remote main remains protected; use a normal PR and all six required checks. No force push, protection bypass or manual production deployment.

The full-policy generation did not pass. Its final progression stage reported 816 violations (mostly duplicate comparisons against frozen and previous-active baselines) and a test alias-escape budget increase from 632 to 637. Policy was last updated at 3fd7478a on September 12; accepted main 1afa55b7 contains 159 subsequently changed JS paths. Two unchanged sample modules were rescanned with current tools and reproduced the stored findings; several reported modules did not exist at the old policy checkpoint. These facts establish a substantial inherited source/policy gap, not that every reported finding is inherited.

The user explicitly allowed reasonable relaxation of merge requirements. Full historical policy regeneration is therefore not an additional merge prerequisite for this delivery. No frozen baseline or diagnostic budget is reset, tools/state_writer_policy.json remains unchanged, and no accepted-main reconciliation framework is added. Focused behavior/proof tests and the repository's existing protected-branch CI checks remain required. Full policy acceptance is an explicit remaining limitation, not a claimed pass.
