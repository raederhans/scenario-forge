# Editor kernel renewal

## Goal and source

Implement the aggressive A–E plan in the user-selected conversation, preserving its stop conditions and existing successful optimizations.
Source: https://chatgpt.com/c/6aa0b8ff-8bec-83ec-a70c-f01773c7b088 (read in full on 2026-09-09).
The source reviewed fb28b187; implementation starts from 9d4b715a with a clean working tree.

## Scope and stages

1. A: cancellation preserves the old document, dirty state and real undo/redo; diagnose current P4 owner/proof failures and always produce failure receipts.
2. B: side-effect-free import preflight and staging, revision/request guarded single commit, awaitable file/text outcomes, optional resource warnings and retry. Retire the old mutating asynchronous orchestration.
3. C: lightweight change-driven history/UI/render updates; verify existing color-only optimization and remove remaining demonstrably unrelated work. Separate input queue, handler, visible feedback and background convergence measurements.
4. D: task execution identity, cancellation, generation/revision guards, bounded waits, cooperative CPU slices and resource cleanup through the existing scheduler/runtime.
5. E: one concrete upstream data family with stable IDs and build-time normalization/version/cache contract; prepare the existing artifact-only publishing path for reproducible builds and rollback.
6. Integrated verification: domain invariants, actual assembly, source and built-artifact user journeys including editing during real background work.

## Acceptance criteria

- Cancelled or failed precommit import preserves the old project and both history stacks; duplicate/stale imports cannot commit.
- Successful commit owns document semantics/history/dirty/save baseline; optional failures remain visible and recoverable.
- Pure color history avoids unrelated consumers without losing visual or saved semantics.
- Old task completion cannot clear a new execution or publish into another scene; cancelled/expired tasks have explicit terminal outcomes.
- Data identities survive reordering; valid unloaded references remain legal.
- Build artifacts identify their source/assets and can be reproduced and used for rollback; representative editing/save/reopen flows run on artifacts.
- Claims distinguish focused local tests, browser observations, performance samples, remote CI and actual deployment.

## Constraints

Two main implementation lanes plus primary integration; bounded read-only mapping may run separately. Shared state, renderer, verification and publishing paths have a single owner. Reuse existing pipelines; no global rewrite, new map engine, global TypeScript migration, blanket fingerprint refresh, or relaxed failure allowlists. Preserve existing work. Production promotion and removal of tracked dist remain dependent on artifact/deployment/rollback evidence and explicit authorization for the actual production action.

## Authorized remote integration and cleanup follow-up

The user subsequently requested remote merge/push and sequential cleanup of accumulated worktrees and branches, preserving recent optimization benefits. Root is the sole Git integration owner. Inventory every worktree and branch, distinguish ancestry/patch-equivalence from independent changes, preserve unowned WIP and recovery identities, and use the existing protected-main PR process. Resolve real required-check failures without bypassing protection or refreshing frozen P4 baselines. Cleanup follows verified integration or documented complete coverage; retain any branch/worktree with unresolved independent value. Record final remote merge/deployment status and cleanup receipts in the existing registry/context.
