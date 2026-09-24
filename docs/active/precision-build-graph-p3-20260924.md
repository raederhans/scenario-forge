# Content-addressed build stages and LOD reuse

Base main: `2b2f1fecf9c388616a01dfb10da5e372ea65b3dc`. Independent P3 batch.
Preserves merged #152-154, the default verified-artifact release, canonical data,
geometry tolerances, original simplification rules and exact boundary checks.

## Implementation

`tools/precision_build_graph.py` executes explicitly declared dependencies in
serial topological order. Stage keys bind named file content, parameters,
algorithm-file closure, engine version, toolchain and dependency output hashes.
All input declarations and graph cycles are checked before execution. Both fresh
outputs and cache hits are inventoried and owner-validated. Failed builds are
not published; changed inputs/dependency artifacts fail; corrupt cache entries
are quarantined, not silently trusted. Linked paths are rejected. Concurrent
identical publication is accepted only when both identity and output bytes agree.
This does not authorize publication and does not sandbox trusted build callbacks.

The existing display LOD builder now uses the graph for each regional and world
simplification stage. It retains the original simplifier and all ID, coverage,
hole and deviation checks. Cache keys include exact input feature content and
Python/Shapely/GEOS versions. Unchanged/fallback results retain their existing
identity-based no-op behavior. Cached/uncached output assets must match byte for
byte; timing/cache diagnostics deliberately differ. No geometry is published.

Run the normal builder with `--cache-root .runtime/cache/display-lod` to choose
a cache location, or `--no-cache` for an independent oracle. A repeated identical
build should report hits without executing simplification. Each report names
stage keys, hits, invalidations, output digests and elapsed time. The graph is a
reusable owner-controlled API, not a complete global pipeline migration: global
geometry/sidecar/assembly stages still require their individual integration and
validation before claims of incremental reuse. The existing historical adjacency
cache remains intact and is not rebuilt in parallel.

## Validation

`python -m unittest tests.test_precision_build_graph tests.test_political_display_lods -q`
checks source/parameter/toolchain/dependency invalidation, graph cycles, corrupt
and extra outputs, input changes during build, link rejection, failure cleanup,
regional/world warm reuse and exact cold/warm/uncached published-asset equality.
These include synthetic geometry fixtures, not the user's untracked precision
candidates. No end-to-end latency, real-device peak-memory or publication claim.
