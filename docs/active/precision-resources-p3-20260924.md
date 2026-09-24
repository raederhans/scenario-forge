# Shared runtime resource accounting and speculative admission

Base: main `2b2f1fecf9c388616a01dfb10da5e372ea65b3dc`. This is an independently
reviewable subset of the P0-P5 continuation. No canonical data, generated dist,
branch protection or production deployment is changed.

## Implemented boundary

`runtime_resource_budget.js` owns scalar accounting only. Private Symbol owners
report/release their estimates; the ledger never retains geometry, payloads or
bitmaps and never evicts another owner's objects. One page module instance is
shared by chunk schedulers and the geometry worker client. Worker acknowledgements
report their caches back to that page instance.

The 256 MiB soft ceiling controls speculative admission, not required user work
and not actual browser heap allocation. Unknown categories are explicit. Existing
per-scheduler concurrency/32 MiB admission and single oversized required-operation
behavior are retained. A cancelled fetch that ignores abort keeps its reservation
until actual settlement. A newly required consumer promotes an already queued
speculative request instead of duplicating it or waiting forever behind pressure.

Worker accounting covers acknowledged geometry/path estimates, retained 2D surface
weights and transferred geometry buffers while they are consumed. It does not
pretend to measure Path2D/native memory, display-owned ImageBitmaps, full main-thread
geometry or every canvas. `snapshot().unmeasuredCategories` documents these gaps.
The worker client does not close caller-owned accepted bitmaps when disposed;
existing orphan/stale bitmap handling and frame identities remain unchanged.

`chunk_payload_loader.js` pressure eviction and its pure cache policy are NOT part
of this subset. They remain on `codex/precision-continuation-p0-p5-20260924` with
all seven integration tests and an unresolved source-proof reconciliation. This
split preserves that work without publishing it as accepted. This PR therefore
adds scheduler capability and actual worker reporting, not universal cache eviction.
A separate transport increment connects real full-pack prewarm to speculative
admission and the same ledger.

## Evidence and reproduction

The integrated draft run `35982865632` passed 59 Node tests and the unchanged
Chromium native 93-feature pixel oracle. Its state-boundary run passed 128/130:
the two failures concern the excluded chunk payload loader/cache policy only.
The draft is NOT a green run. Current PR checks must validate this extracted tree.
Worker-specific integration assertions were copied into
`tests/worker_resource_accounting_behavior.test.mjs`; the original integration
suite remains intact on the cache-pressure branch.

Focused checks:

```sh
node --test tests/runtime_resource_budget_behavior.test.mjs tests/worker_resource_accounting_behavior.test.mjs tests/precision_scaling_scheduler_behavior.test.mjs tests/geometry_raster_worker_client_behavior.test.mjs
node --test tests/state_action_delegation_edges_behavior.test.mjs tests/state_borrowed_effect_contract_behavior.test.mjs
node tools/check_architecture_boundaries.mjs
npm run verify:edit -- --changed-file js/core/runtime_resource_budget.js --changed-file js/core/geometry_raster_worker_client.js
```

A local browser can inspect `pageResourceBudget.snapshot()` from the module. Save
snapshots before load, during old/new scene coexistence, after settlement and after
turning off the optional layer. Compare known category deltas, peak estimates,
unknown categories and active owner counts. These are estimates, not heap measurements.

The user's untracked 3,144-county candidates remain unavailable to this cloud run.
Use the exact candidate root and receipt workflow from PR #155 for the fixed-code
versus fixed-data experiments. This increment has no candidate performance receipt,
no controlled end-to-end improvement percentage and no data publication approval.

Integration: PR #155 and #157 append independent verification records. Preserve
those additions when combining their catalog changes with this PR's expanded
existing scheduler route; do not replace one branch's whole catalog with another.

## Local integration, 2026-09-24

The local integration owner merged main through #160 without changing its lake
or river data. Resource budget, worker accounting, worker client, chunk scheduler
and verification metadata tests pass together: 80 tests, zero failures/skips.
The owner runs tests and servers serially; delegated reviews are read-only.
Logs: `.runtime/tmp/pr158-161-closeout/resource-tests.log`.

The documentation projection assertion now compares the exact unique authored
documentation source set instead of a stale literal count. It still rejects
missing, extra or duplicate projected entries. This resolves the common CI
failure in #158/#159/#161 without weakening coverage. Current-head hosted checks
and final integrated deployment remain separate acceptance steps.
