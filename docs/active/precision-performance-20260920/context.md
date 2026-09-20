# Context

Branch: codex/precision-interaction-performance. Main owns shared integration, map_renderer.js, scenario composition, derived-state/index modules, verification routing, builds and browser processes. Preserve untracked .playwright-mcp/.

CLI lanes are disjoint. Hover lane owns map_hover_interaction_owner.js and its tests. Worker lane owns its new codec and named worker/client files. Neither may mutate git, dist, data, shared test metadata, or start servers/builds/browser. Short isolated tests only. Main will verify their diffs and handle shared integration.

Baseline research: full political coverage is intentional; spatial culling already exists. Do not remove global coarse to imitate a speedup. Existing incremental caches avoid many geometry calculations but still scan/recompose full arrays. Historical 766/899ms promotion observations are not current timings or proof that indexes dominate.

CLI workspace_write setup failed before executing changes (missing registered command_status and send_command_input). Both tasks were resumed read_only; parent integrated the proposed hover/transport design with corrections and owns all writes. Hover CLI has been resumed for a bounded correctness review.

Main owns the following sequential shared validation runs. No other agent may start these resources:
- Build: npm run python -- tools/build_pages_dist.py --output-root .runtime/reports/generated/precision-performance-pages (artifact only).
- Browser: PLAYWRIGHT_TEST_SERVER_PORT=8003; MAPCREATOR_OPEN_BROWSER=0; focused existing scenario_chunk_exact_after_settle_regression.dev.spec.js cases, workers=1. Playwright owns and tears down its localhost server.
- Logs: .runtime/tmp/precision-performance/; Playwright output: .runtime/tests/playwright/.

## Implemented result

- Added a per-bundle political geometry store: stable coarse/detail source indexes, detail-first winner map, revisioned change/removal descriptors, complete-world semantic coverage. Detail eviction restores coarse geometry. Compatibility feature arrays still cost O(N); this is not a tiled renderer migration.
- Propagated snapshots through normalization and derived-state caches. Mutable metadata checks remain; skipped generations fall back to comparison. Incremental primary indexes preserve picking keys and only request bounds for changed features. Added politicalDerivedStateBreakdown with metadata, primary index, colors and spatial/commit phase durations.
- Hover hit work is coalesced to the latest pointer per animation frame. Leave/reset cancels queued hits. Dirty point probes and hit-surface draws reuse the same polygon Path2D cache as political drawing. Click/brush APIs retain their existing behavior.
- Shared lossless Float64 coordinates and Uint32 structural lengths codec works in classic startup workers and module raster workers. Newly allocated buffers are transferred; input GeoJSON stays usable. Plain GeoJSON is restored at the receiver. Small updates below 16,384 coordinate scalars use the existing message path. Metrics include packing and unpacking.
- CLI supplied hover and transfer designs and a bounded correctness review; parent applied corrections and all code changes. Review prompted retaining mutable metadata checks and clearing extra-ID bookkeeping across legacy transitions.

## Verification and measured results

- Final targeted Node run: 99 passed, 0 failed (node-final.log).
- Additional color-history/undo refresh, hit-candidate ranking and hit-canvas scheduling checks: 27 passed (interaction-history.log); 126 distinct Node cases in total.
- Renderer spatial/hover/chunk Python contracts: 53 passed (python.log).
- Final artifact build: 512.49 MiB, .runtime/reports/generated/precision-performance-final-pages. Startup worker/module dependency graph check passed against that artifact (module-graph.log).
- Architecture boundaries, E2E layer coverage, generated test import graph and all changed-file routes passed; no unmatched changed files. Existing .playwright-mcp/ was preserved.
- Localhost browser: TNO drag/no black frame, Great Lakes/Congo zoom fill, post-edit progressive recovery, and full/rendered color coverage all passed (browser.log).
- Real classic-worker decode + module-worker upload/reuse passed. An initial comparison of political/hit bitmap pixels failed once, without a captured difference size; the assertion was retained and extended with difference diagnostics. The isolated rerun plus three-repeat and eight-repeat stability runs all passed (12 successful follow-ups). This remains a bounded observation rather than a proven cross-GPU pixel determinism guarantee. Source and restored JSON equality, usable source geometry, non-empty drawing, no worker fallback and zero second-frame geometry uploads are also asserted.
- Warm local Node composition benchmark, ten samples each, real TNO coarse plus GER, full output equality asserted: promotion 6.62 -> 5.84 ms; eviction 6.32 -> 5.64 ms. Samples exclude cold normalization and rendering. Script and samples: .runtime/tmp/precision-performance/benchmark-composition.mjs and composition-benchmark.jsonl.
- Lossless transport benchmark, ten measured samples after two warmups, includes packing + structuredClone/transfer + reconstruction: coarse (12,019 features) 165.14 -> 110.35 ms; GER (841 features) 42.81 -> 29.15 ms. These are Node transport-stage medians, not browser FPS, worker round-trip or whole-promotion timings. Script and samples: .runtime/tmp/precision-performance/benchmark-transfer.mjs and transfer-benchmark.jsonl.
- The initial items 1–4 did not replace source data, deploy, rewrite the GPU backend or redesign cache budgets. The subsequent cache work is recorded below. End-to-end batch rollout headroom still needs a controlled browser baseline on target devices.

## Follow-up item 5 and existing giant geometry

Parent exclusively owns subsequent shared validation resources: localhost port 8003, focused native raster budget/transfer tests plus TNO zoom/post-edit and physical water regression; artifact-only build to .runtime/reports/generated/precision-cache-pages. CLI read-only task 2e9aba1fa44c4a5b9c6243f270659ae9 researched component hit contracts, confirming water already uses component-level spatial items. Parent preserved this flow instead of adding another containment algorithm.

- Added weighted LRU retention budgets: main political paths 32 MiB, water paths 32 MiB, worker paths 32 MiB, decoded worker geometry 64 MiB. Weights estimate retained geometry/path complexity; they are not measured heap bytes or a total browser memory cap. Existing source-chunk protection and bitmap ownership remain in place.
- Oversized paths draw transiently without flushing hot entries. Worker current-frame geometry stays pinned even above target; inactive geometry is retired with eviction acknowledgements, and the client re-uploads it when needed. Budget usage, evictions, oversize skips and pinned overshoot are exposed in metrics.
- Water whole-feature paths replace duplicate component path retention. Geometry-part identities and D3 projected bounds are reused; projection generation, scenario changes and explicit resets invalidate bounds. Source coordinates, polygon holes, canonical parent IDs and existing hit ranking are preserved.
- Scanned scenario political coarse/detail chunks (799 detail files), three supplemental political GeoJSON assets, and scenario water files. No scanned political feature reached 10,000 points. Actual giants include TNO Bothnian Sea (54,187 points/40 parts), Norwegian Sea (40,131/91), and Baltic Sea (36,341/7,391). No source data was simplified or rewritten.
- Corrected production-entry benchmark: actual HEAD baseline owner versus current owner, both using collectSafeWaterRegionGeometryParts and buildWaterSpatialItems, real D3 Equal Earth, ten measured iterations after two warmups. Baltic/Bothnian/Norwegian Sea median rebuild 35.93 -> 1.85 ms; repeated projected-bounds calls 7,522 -> 0. Full deep equality of all 7,522 resulting items is asserted. The earlier 80.24 ms comparison recreated parts unnecessarily and is superseded. This is a warm local spatial-item rebuild, not first-render latency, FPS or total promotion time. Script/result: .runtime/tmp/precision-performance/benchmark-giant-water.mjs and giant-water-benchmark.jsonl.
- Core budget/cache/worker/spatial suites: 109 passed (cache-final-node.log). After final whole/component path deduplication, water suites passed and an additional overlay/projection-boundary run passed 46 cases, including the new duplicate-retention regression (cache-additional.log). The focused TNO water topology source contract also passed (cache-contract.log).
- Five localhost browser cases passed: native cache pressure preserves holes and geometry re-upload, real classic/module worker transfer, TNO zoom fill, TNO post-edit fill and physical water/atlas defaults (cache-browser.log).
- After the final duplicate-path retention change, the physical water/atlas browser case passed again on the final source (cache-water-final-browser.log).
- Artifact build passed at 512.50 MiB: .runtime/reports/generated/precision-cache-pages; startup worker/module graph check passed against this output (cache-module-graph.log). Architecture boundaries, generated test-import graph and route schema passed; all 42 changed paths are accounted for (three task records are explicitly nonbehavioral). git diff --check passed.
- Changes remain uncommitted and undeployed on codex/precision-interaction-performance; unrelated .playwright-mcp/ remains untouched.
