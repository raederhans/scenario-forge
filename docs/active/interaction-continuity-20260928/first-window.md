# First-window preparation — 2026-09-28

Implemented earlier global navigation prefetch after synchronous scenario map/shell/border updates, before awaited coarse prewarm. Synchronizing the renderer scene snapshot prevents a later sceneGeneration bump rejecting the request. Source identity is separate from paint identity. Missing registries can be discovered; complete payloads survive cache eviction until captured by a private raster job; obsolete payloads are released. Explicit prewarm permits private preparation during apply, with strict paint/projection checks before publication.

Navigation now uses a separate disposable geometry raster worker. Entry collection yields on the main thread; lossless geometry packing processes at most 32 features per batch and yields around 4 ms. The worker reconstructs the same EqualEarth projection and canonical ordered fills, including compound water geometry and alpha. Complete bitmaps publish atomically into the existing 1024×498 navigation canvas. Cancellation releases bitmaps and the worker; unsupported/failed workers retain sliced main-thread fallback. Geometry simplification remains disabled. A single large feature remains indivisible during packing.

The initial worker migration did not sufficiently reduce readiness time. Phase metrics exposed 4135.9 ms accumulated Canvas fill cost in a HOI worker, including 4110.3 ms in one fill. Navigation-only software canvas (`willReadFrequently: true`) was retained after comparison. Political/hit canvas settings are unchanged. [MDN API reference](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/getContext) explains the software rendering hint; performance remains browser/device dependent. Native edge antialiasing can differ; no pixel-identical claim is made.

| Local sample | Default worker canvas | Software navigation canvas |
|---|---:|---:|
| HOI complete preparation | 7378.5 ms | 4008.0 ms |
| HOI worker render | 5916.4 ms | 2686.7 ms |
| TNO complete preparation | 7573.4 ms | 4313.5 ms |
| TNO worker render | 6983.0 ms | 3531.9 ms |

These are individual diagnostic samples, not statistical A/B results, FPS or input-latency guarantees. Previous-round main-thread preparation was 7305.3 ms. Geometry and bitmap resolution are unchanged.

Final immediate-drag replay: TNO, 200%, balanced, map 1146.7×904, DPR 1.5. Source loading took 1008 ms and navigation preparation 4242.8 ms. Among 135 sampled interacting frames after scenario apply unlocked, 87 used navigation, 3 used fast rendering, and 45 retained previous pixels without presenting the target transform. All 90 presented samples matched target/presented transforms. Navigation completed 7363 ms after apply, while the first unlocked target sample was at 3132 ms: approximately 4.23 s still remained after unlock. Different drag start times prevent direct frozen-frame count comparisons with earlier replays. First-window continuity remains PARTIAL. Scene application also produced 1850 ms and 934 ms long tasks.

Final state converged to TNO exact/idle, geometryPendingCount 0, borderScheduled false, exactPending false; browser console errors were empty. Temporary worker geometry estimates can exceed the 64 MiB target (TNO about 143 MiB); the worker is disposed after completion, retaining only the approximately 1.95 MiB navigation bitmap. Estimates are not measured process heap.

Validation: 32 Node navigation/frame/source tests plus 41 worker/client/kernel/resource/transport tests, and 5 Python renderer-bridge boundary checks. Coverage includes early registry discovery, prefetch across paint changes, stale cancellation, water order/alpha, packing cancellation, bitmap release, fallback and political/hit compatibility.

Evidence in `.runtime/browser/first-window/`: `hoi4-worker-initial.json`, `tno-first-drag-initial.json`, `hoi4-gpu-bitmap.json`, `hoi4-cpu-bitmap.json`, `tno-cpu-first-drag.json`, `tno-immediate-drag-final.json`. Work remains local and uncommitted; prior work is preserved.

Next substantive work: prepare navigation before scene publication and address scenario-promotion long tasks. This round reduces preparation cost but does not guarantee continuity from the first input after switching.
