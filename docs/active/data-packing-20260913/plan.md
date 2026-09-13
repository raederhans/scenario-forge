# Data packing implementation

User authorized the three follow-ups on 2026-09-13: compact runtime artifacts, complete gzip reading paths, and feature-preserving spatial chunks for large countries. Preserve quality, all feature IDs/properties/coordinates, existing global coverage/edit/undo/export semantics, and unrelated WIP.

1. Compact JSON at the published-artifact boundary with lexical token preservation and byte-exact exceptions; refresh derived byte/hash metadata.
2. Decode explicit compressed resource URLs in worker and main thread, with cancellation, error handling and existing-browser compatibility. Publish compressed scenario chunks only after both paths work. Separate encoded transfer bytes from decoded/cache costs.
3. Deterministically subdivide oversized owner chunks without clipping features. Preserve whole-owner small chunk IDs, validate owner/shard membership, adapt focus prewarm and incremental reuse.
4. Generate a scoped real-data prototype and final isolated Pages artifact; verify exact data preservation, manifest reachability, relevant runtime behavior, and measured size/loading costs.

No coordinate rounding, new simplification, remote changes, commits or deployment. Parent owns integration, real-data generation, browser/server/build lane. Worker-local synthetic tests may run independently.

Acceptance: actual lossless serialization/gzip round trips; identical full-detail feature set and geometry; deterministic unique shard assignment with complete bounds; valid manifests; existing cache protections and budget semantics preserved; focused pan/zoom, chunk loading in both worker modes, edit/undo and export checks. Measure size and relevant work counts; no unsupported FPS claims.
