# Progress

- [x] Paint intent and regression tests (fix_paint_intent).
- [x] Contours default off and demand loading (default_contours_off).
- [x] Persistent political base coverage and detail replacement (political_base_coverage; main integration).
- [x] Scenario-safe recovery and render scheduling (main); request waits for dispatcher RAF before visible metrics.
- [x] Replace repeated global border scans with indexed country/neighbor meshes and cancellable slices.
- [x] Integrate, targeted tests, focused browser verification, necessary dist synchronization (main).
- [x] Inspect Adriatic, Congo Lake, Russian Arctic and Somalia; document remaining source-contract and pixel-selection limits.
- [x] Close owned localhost browser/server resources; retain local changes without remote publication.

Follow-up performance research (user confirmed most visual bugs fixed):
- [x] Profile ordinary TNO pan / zoom / fill at DPR 1 and repeated gestures at DPR 2.
- [x] Verify viewport-subset forced refresh and stationary-click camera lifecycle with isolated browser response prototypes.
- [x] Rank local and architectural changes with correctness boundaries. Product implementation of these follow-up candidates is not included in this research pass.

Authorized implementation of performance layers 1 and 2:
- [x] Lazy real-camera gesture lifecycle and duplicate final-frame removal (fix_paint_intent).
- [x] Global-coverage viewport no-op selection and promotion recovery coordination (main).
- [x] Projection/geometry-only Path2D and border simplification caches (political_base_coverage).
- [x] Incremental country fill appearance, frame-local cache validation and hit rebuild deduplication (main).
- [x] Targeted integration tests, ordinary-mode continuous interaction and visual/undo checks, dist synchronization (main).
- [x] Separate third-layer worker assessment from post-change profiles (main); see worker-assessment/plan.md. No Worker implementation in this stage.

Authorized third-layer implementation:
- [x] Persistent pure border mesh Worker and cancellable lifecycle integration.
- [x] Persistent D3 geometry raster Worker for hit and political fine pass; correct clipping and feature policies.
- [x] Main-thread versioned publication, bounded requests and immediate edit/undo behavior. Exact composition prototype measured; keep current compositor because full-layer transfer regresses total latency.
- [x] Targeted async/geometry tests, ordinary cold/warm profiling and visual/scenario/region checks. Includes semantic water/relief regression found during Congo inspection.
- [x] Dist synchronization and final evidence/remaining limits. See worker-results/context.md; final full-water source has reduced pan blocking, but cold zoom, fill latency and memory overhead remain explicitly measured limits.
