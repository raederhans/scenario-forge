# Political raster, second delivery: R3/R4 revision

Baseline: 33b9f754d1e55298450ecca34e75d404b3f20906, building on the R0-R2 resident candidate in PR #229. Main remains b09a2e8e40895789924adee4305750fc642458d6. The earlier six PR workflows and independent five-case 1936 legacy regression completed successfully. They are evidence for the earlier commit, not this change.

## Revised execution contract

The first delivery proved resident rendering and canonical edit/history preservation, not stable acceleration. This delivery therefore moves performance attribution ahead of default admission. R3/R4 comprise retained-region RGBA presentation, explicit stage timings, separate pixel-quality checks, native/full-raster/retained-raster comparisons, and navigation/lifecycle verification. R5 prebuilt asset regeneration and raster-first startup, R6 default-on admission, general layer migration and Windows hardware-GPU acceptance remain gated subsequent deliveries. This is a revision of the execution order, not a claim that those later objectives are complete.

Canonical vector geometry, IDs, picking authority, palette and history stay unchanged. The new cache owns only disposable RGBA pixels and a palette byte snapshot. Source tile contributor codes conservatively determine recolor regions. Unknown contributors, palette namespace growth, geometry/grid changes, scene replacement and context loss cause full redraw. Identical raster-grid pans and unchanged palettes reuse the RGBA image. A changed color redraws one bounded union region, not individual per-tile WebGL readbacks. Transparent regions are cleared before copying. No resolution, projection precision or raster-ID interpolation is changed. Legacy hybrid still uses the original full GPU presentation.

Both retained RGBA and temporary GPU output are charged against the existing 80 MiB admission estimate before allocation; cache-owned palette and dependency arrays are accounted. If only the extra retained surface cannot fit, presentation uses the original full-GPU path instead of reducing raster eligibility. Existing CPU/asset deadlines and resource limits are not enlarged. Diagnostic URL political_raster_present=full selects the previous full-GPU presentation only for paired comparison. It does not write user preferences. Automatic raster eligibility stays disabled.

## Verification and evidence

Focused regression: node --test tests/political_id_raster_display_cache_behavior.test.mjs tests/political_id_raster_runtime_owner_behavior.test.mjs tests/political_id_raster_runtime_assets_behavior.test.mjs

Main-app profiling: node tools/profile_political_raster.mjs --base-url http://127.0.0.1:8008/app/ --scenario hoi4_1939 --revision EXACT_COMMIT

The profiler separates untimed pixel validation from timed input/state/frame sampling. Timings describe input-to-observed-ready and CPU stage wall times, not presentation, GPU execution, INP, or universal FPS. Preserve outliers and report GPU environment. Full-raster versus retained-raster pixels are compared after cold activation, recolor/undo/redo and navigation. The native comparison is diagnostic because raster is intentionally approximate; this delivery must not introduce additional visual degradation relative to the preceding raster path.

Acceptance requires focused tests, architectural boundaries, three-scenario resident lifecycle, full-versus-retained pixel equivalence within the stated one-byte rounding tolerance, no warm geometry rebuilds/native redraws, bounded resource accounting, and inspectable performance results. A passing functional case is not an acceleration gate. A failing case keeps this candidate unaccepted rather than weakening assertions. Required final-head CI, merge and deploy remain distinct.

## Environment boundary

The interactive terminal and Python execution tools returned ClientError before any command ran in this conversation. No conclusion about the user's separately configured cloud workspace follows. Implementation and tests use the already connected repository and its isolated GitHub Actions bootstrap branch. No new cloud service, paid machine, credentials, main push, merge or deployment is created.

Results are recorded separately after execution, pinned to their tested revision. This document does not predeclare tests successful.


## Initial verification receipt

Run 38217354006 committed runtime 250a17e392bec8862a716a828d0ba5ed3a51a166 after 243 focused Node cases, five Python boundaries, architecture and current source-family checks passed. The browser then stopped before any quality/timing sample: the new profiling wrapper passed null to a predicate whose default argument requires undefined. This is a harness bug, not a product or user-environment failure. Its correction changes the invocation and adds a regression; readiness and pixel tolerances remain unchanged. Additional coverage verifies that the optional retained surface cannot shrink the existing raster resource envelope.


Presentation identity uses WeakMap tokens rather than retaining tile objects. This prevents the RGBA cache from extending the lifetime of evicted CPU buffers during geometry replacement. An explicit --expose-gc regression verifies that a released tile can be collected while the presentation frame remains cached; ordinary test runs report that GC-specific case as skipped when GC is unavailable, not as passed.
