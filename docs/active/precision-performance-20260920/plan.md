# Precision performance implementation

User authorized implementation of research items 1–4: end-to-end incremental promotion, hover/picking optimization, stable coarse/detail composition, and lower-copy worker geometry transport.

Preserve full precision, canonical IDs, complete-world semantic coverage, draw/hit precedence, editing/undo, cancellation and scene-generation guards. No production deployment or source-data replacement is in scope.

1. Main: stable coarse/detail composition with immutable change descriptors; propagate geometry deltas into derived state/indexes and measure promotion phases.
2. CLI hover lane: frame-coalesced hover calculation with cancellation and unchanged synchronous click/brush semantics. Main integrates cached point probes.
3. CLI worker lane: lossless transferable geometry packets and meaningful transfer/round-trip verification. Preserve plain GeoJSON consumer contracts and fallback behavior; measure conversion overhead before claiming a gain.
4. Main: integrate targeted behavior/contract tests, localhost runtime checks, and relevant build/module graph validation.

Acceptance: full versus incremental parity; detail removal restores coarse geometry; stable remote feature access; holes/overlaps/water/special-region hit precedence; color and undo parity; stale worker results rejected; no detached source geometry; no unrelated WIP changes. Performance evidence must distinguish operation-count reductions, local samples, and controlled timing.

## Follow-up: cache budgets and existing giant geometry

User authorized item 5 plus treatment of giant geometries already in the project.
Implement weighted LRU budgets for political/water/worker projected paths and worker decoded geometry, with pinned current-frame geometry, eviction acknowledgements and diagnostics. Weight estimates do not claim exact JS/native heap measurements. Keep the existing protected source chunk policy and bounded bitmap ownership.

Inventory actual assets before choosing giant-geometry handling. TNO water contains 54k-point geometry and 7,391-part Baltic Sea. Its hit candidates already split by polygon. Reuse stable polygon-part identities and projection bounds across rebuilds, reset on projection/scene/explicit reset, preserve canonical IDs, holes, antimeridian behavior and all source coordinates. No simplification, source-data rewrite or deployment.
