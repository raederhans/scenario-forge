# Political patch cost continuation

Base: main 2b2f1fec. Preserve Windows immutable ImageBitmap composition,
full device-space raster coordinates, painter order, holes, cancellation and
full-render fallback. No geometry, tolerance, 48-feature synchronous limit or
cache limit changes. No production data or deployment change.

The accepted-frame planner now retains a numeric screen-grid bounds index across
verified structurally identical entry/view generations. Unknown bounds or any
geometry/order/width/view mismatch still fail closed. The full structural scan
and full-frame immutable composite remain; this is not an O(delta) renderer.
The grid owns only copied numbers with weak frame keys. Large bounds use a
bounded spanning list instead of multiplying into unbounded cells. Index memory
is included in the existing transient admission estimate, not a heap claim.
Worker patch clears only the entire published crop; full frames still clear the
full surface. Client diagnostics expose actual rasterized and cleared counts.

A rejected sorted-tree experiment made the first planner call about 139 ms on a
13,486-entry synthetic grid versus about 1 ms before. It is not shipped. A
counterbalanced 2-warmup/5-measured-pair grid microbenchmark, six edits per side,
recorded medians about 1.09/1.17 ms before/after on the first call and 0.97/0.11 ms
on subsequent calls. Bound getter calls across six edits fall 80,916 to 13,486;
121 contributors remain for the same 93 edits. This measures the planner only,
not rasterization, browser input latency or the user's real county candidate.
Raw accepted and rejected samples are retained by the cloud execution owner.

Local checks: 67 worker/client/planner/runtime tests; 130 borrowed-effect and
delegation tests; architecture and unchanged 64-spec import graph. Native checks
add alternating separated crops through the existing served module-worker case,
retaining exact RGBA equality and the original assertions. Native/hosted results
must be checked on the final PR head before acceptance. The 3,144-county candidate
remains unavailable, not-run and not performance approved.
