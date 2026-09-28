# Plan

## Goal
Keep pan, drag, wheel zoom and viewport commands spatially continuous while reducing interactive and recovery cost. User authorized the complete sequence and bounded CLI delegation on 2026-09-28.

## Scope and sources of truth
Work from origin/main@291b5aa2 in the clean reusable pan-zoom-integration checkout. Preserve the dirty primary checkout. Current renderer code, focused behavior tests and fresh localhost observation are authoritative; previous TNO traces are diagnosis evidence, not new measurements.

## Stages
- [x] 1. Separate target camera, raster reference and actually presented camera; keep geography-anchored surfaces aligned while exact work waits; add reliable low-resolution navigation coverage.
- [x] 2. Prepare coverage before exhaustion within explicit memory/work budgets, retaining scene, projection and paint correctness.
- [x] 3. Reduce water/label and worker recovery stalls with bounded work and latest-useful-task priority, based on observed hotspots.
- [x] 4. Stabilize detail restoration and make programmatic camera transitions short, cancellable and anchored; direct manipulation stays direct.
- [x] 5. Validate continuous/reverse pan, zoom-out and interrupted recovery on representative scenarios, inspect visual alignment, and complete relevant repository checks.

Implementation and scoped validation are complete. This is not a claim of universal 60 FPS: cold chunk promotion and other exact-recovery work still have long tasks. See task.md and the final browser evidence for measured limits.

## Acceptance criteria
- A ready map continues moving at the requested camera when fine caches wait; no false presented-frame metadata.
- Geographic overlays and raster content agree on the presented camera. Exact handoff does not move landmarks.
- Full-scene navigation coverage uses current scenario/projection/colors/water semantics; no old-scene pixels or invented geographic coverage.
- Protect startup atomicity, edits, export, hit coordinates, worker lifetime and bounded resources.
- Record real continuity and frame timing separately from final idle convergence; do not promise hardware-independent FPS.

## Non-goals and constraints
No geography/data edits, dependency migration, production deployment or discarded unrelated WIP. Existing coverage/identity checks remain enforced. Main agent owns integration and live browser/processes; worker ownership is explicit.

## Authorized continuation: cold recovery and display precision
2026-09-28: user authorized the three follow-up stages after the read-only precision study.
- [x] Attribute cold recovery costs and improve exact geometry/cache/worker reuse.
- [x] Build and validate a water display LOD candidate without replacing canonical geometry. Candidate rejected; no display precision reduction adopted.
- [x] Decide political LOD expansion from measured results; retain exact political data because the water adoption gate failed.

Initial live attribution: TNO 200% detail recovery included two REGISTER_SOURCE worker submissions taking 447.6ms and 387ms synchronously on the main thread. The older 428-535ms long tasks alone did not establish their cause. Current evidence is under .runtime/browser/cold-lod/. Verification used owned browser tab 2 and server session 23213, port8000; both were closed after restoring TNO. No publication is authorized or planned.

Continuation result: exact transferable arc packing plus source reuse is implemented. First registrations cost 122.9ms and 111.8ms including packing; repeated zoom used only UPDATE_POLICY (2.8ms and 0.1ms synchronous sends). Full cold detail promotion still costs about335ms. Water LOD reduced points31.38% but failed winding/coverage/footprint checks. See task.md for scoped validation and measurement limitations.

## Authorized continuation: derived cache and navigation starvation
- [x] Instrument and reproduce the first cold-promotion cache miss; repair only the proven baseline lifecycle issue.
- [x] Remove duplicate visual coverage input construction without weakening coverage validation.
- [x] Reproduce and fix missing coarse navigation sources after returning to a scenario at high zoom.
- [x] Verify cache/coverage/source lifecycle behavior and localhost pan/zoom/scenario convergence.

Result: first detail promotion uses a validated delta; complete color rebuilds can update the paint baseline without certifying changed geometry. Navigation requests evicted coarse inputs through the existing loader and eventually becomes ready after high-zoom scene returns. Initial source load/raster preparation remains slow; no claim of instant new-scene continuity or universal60FPS. Precision reduction remains disabled. Detailed measurements and remaining work are in task.md.


## Authorized delivery
Commit the validated runtime and diagnostic changes, push the feature branch, satisfy required checks, merge through the protected-main PR route, and verify remote ancestry. Retain runtime evidence and unrelated primary WIP. Automatic Pages deployment follows main; distinguish its result from merge proof.
