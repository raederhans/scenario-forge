# Political raster, second delivery: R3/R4 revision

Baseline: `33b9f754d1e55298450ecca34e75d404b3f20906`, building on the R0-R2 resident candidate in PR #229. Base main at review: `b09a2e8e40895789924adee4305750fc642458d6`. The earlier six PR workflows and independent five-case 1936 legacy regression completed successfully. They are evidence for the earlier commit, not automatically for this change.

## Revised execution contract

The first delivery proved resident rendering and canonical edit/history preservation, not stable acceleration. This delivery moves performance attribution ahead of default admission. R3/R4 comprise retained-region RGBA presentation, explicit stage timings, separate pixel-quality checks, native/full-raster/retained-raster comparisons, and navigation/lifecycle verification. R5 prebuilt asset regeneration and raster-first startup, R6 default-on admission, general layer migration and Windows hardware-GPU acceptance remain gated subsequent deliveries. This revises the execution order; it does not claim the later objectives are complete.

Canonical vector geometry, IDs, picking authority, palette and history stay unchanged. The new cache owns only disposable RGBA pixels and a palette byte snapshot. Source tile contributor codes conservatively determine recolor regions. Unknown contributors, palette namespace growth, geometry/grid changes, scene replacement and context loss cause full redraw. Identical raster-grid pans and unchanged palettes reuse the RGBA image. A changed color redraws one bounded union region, not individual per-tile WebGL readbacks. Transparent regions are cleared before copying. No resolution, projection precision or raster-ID interpolation is changed. Legacy hybrid still uses the original full GPU presentation.

Retained RGBA and temporary GPU output are charged against the existing 80 MiB admission estimate before allocation; cache-owned palette and dependency arrays are accounted. If only the extra retained surface cannot fit, presentation uses the original full-GPU path instead of reducing raster eligibility. Existing CPU/asset deadlines and resource limits are not enlarged. These are explicit resource estimates, not measurements of driver VRAM or total JavaScript heap. Diagnostic URL `political_raster_present=full` selects the previous full-GPU presentation only for paired comparison. It does not write user preferences. Automatic raster eligibility stays disabled.

Presentation identity uses WeakMap tokens rather than retaining tile objects. This prevents the RGBA cache from extending the lifetime of evicted CPU buffers during geometry replacement. An explicit `--expose-gc` regression verifies that a released tile can be collected while the presentation frame remains cached. Ordinary runs skip that GC-specific test when GC is unavailable; skipped is not passed.

## Implementation scope

The second batch changes eight product files relative to its baseline: the independent display-cache module; runtime-owner glue, accounting and stage diagnostics; GPU viewport culling; display-cache and runtime tests; the profiling harness; existing verification-route registration; and this document. It does not change the root renderer, canonical vector/source assets, editing/picking authority, export implementation, public project formats or dependencies. Temporary integration workflows stay on the owned bootstrap branch and are not in the product PR diff.

Commits:

- `250a17e392bec8862a716a828d0ba5ed3a51a166`: retained-region presentation, accounting, diagnostics, tests and profiler.
- `a16fdadd1f12b128af65397fa1bbdee6ff7640d1`: correct the profiling predicate argument and add presentation-budget fallback coverage. Runtime rendering is unchanged from `250a17e3`.
- `195f49919d274b21294ebf349794bcae16cff747`: replace strong presentation tile references with non-owning tokens and add GC regression. This is the final runtime for the second batch; its pixel/lifecycle checks are separately pinned.

## Reproduction and measurement contract

Focused regression:

```sh
node --test tests/political_id_raster*.test.mjs tests/political_pass_orchestrator_owner_behavior.test.mjs tests/political_partial_repaint_owner_behavior.test.mjs tests/renderer_political_pass_orchestration_preflight.test.mjs
node --expose-gc --test tests/political_id_raster_display_cache_behavior.test.mjs
```

Main-app profiling from a built and locally served Pages artifact:

```sh
node tools/profile_political_raster.mjs --base-url http://127.0.0.1:8008/app/ --scenario hoi4_1939 --revision EXACT_COMMIT
```

Run 1936, 1939 and TNO separately. The profiler separates untimed pixel validation from timed input/state/frame sampling. Timings describe input-to-observed-ready and CPU stage wall times, not display presentation, GPU execution, INP or universal FPS. Each scenario uses vector/full/retained/retained/full/vector order with six real canonical paints per block. Preserve outliers and report GPU environment. Full-raster versus retained-raster pixels are compared after activation, edit/brush undo-redo, local recolor and navigation. Native pixel comparison is diagnostic because raster is intentionally approximate; this delivery must not introduce additional degradation relative to the preceding raster path.

Functional acceptance requires focused tests, architecture boundaries, three-scenario resident lifecycle, full-versus-retained pixel equivalence within the stated one-byte rounding tolerance, no warm geometry rebuilds/native redraws, bounded resource accounting and inspectable performance results. Functional acceptance is not the default-on performance gate. Final required CI, merge, deployment and hardware acceptance remain distinct.

## Environment boundary

Interactive terminal and Python tools returned `ClientError` before commands ran in this conversation. No conclusion about the user's separately configured cloud workspace follows. Implementation and verification used the connected repository and isolated GitHub Actions bootstrap branch. No additional cloud service, paid machine, credentials, main push, merge or deployment was created. The working test environment was Ubuntu hosted Chromium using ANGLE/SwiftShader software graphics, not the user's Windows hardware GPU.

## Failed initial check retained

Run `38217354006` committed `250a17e3` after 243 focused Node cases, five Python boundaries, architecture and selected current-source-family checks passed. The browser stopped before any quality/timing sample: the new wrapper passed null to a predicate whose default state requires undefined. This was a harness bug, not a user-environment or rendering failure. The correction changes the invocation and adds a regression; readiness and pixel tolerances remain unchanged. Additional coverage verifies that the optional retained surface cannot shrink the existing raster resource envelope.

Failure artifact: `raster-part2-candidate-evidence`, ID `11732735885`, SHA-256 `725ba7049dda48b7c4df56cd20d0d8ef79a14a381d8795f20ada59c876f6d77f`.

## Completed three-scenario profile receipt

Run: https://github.com/raederhans/scenario-forge/actions/runs/38217999534

Tested revision: `a16fdadd1f12b128af65397fa1bbdee6ff7640d1`. Artifact: `raster-part2-final-evidence`, ID `11732584357`, SHA-256 `70764d5582b5eab4b1728927c2c41ad2961617ca99b90d26f6851bb43fcff429`.

This run passed 245 focused Node tests, five Python boundaries, architecture and planning, then all three real-browser profile cases. The planning step remains planning, not an additional test. The earlier 243-case run overlaps and must not be added to the count.

All 18 retained-versus-full-raster pixel comparisons were exactly equal: `changed=0`, `maxDelta=0`, not merely within the allowed one-byte rounding tolerance. Each compared 1,051,884 political-pass pixels. The six conditions per scenario were initial frame, edit-and-brush history, local recolor, 130%, 250%, and return to 100% zoom. This proves no added pixel degradation from the new presentation cache in those views, not native-vector parity or full perceptual acceptance at every scale.

Each six-click warm raster block had six raster primary passes, zero native background/fine/partial calls and zero additional geometry builds. Each retained local change shaded 262,144 pixels rather than the full 3,145,728-pixel raster-grid output, a 1/12 region in this fixture. Other features or distant multi-feature changes can legitimately touch larger regions or use the full frame.

### Input-to-observed-ready results

Twelve raw samples per mode/scenario, combined conventional median; units ms. Maxima are retained, not filtered.

| Scenario | Native median / max | Full-raster median / max | Retained-raster median / max | Retained median reduction versus full raster |
|---|---|---|---|---|
| 1936 | 273.75 / 1091.5 | 451.05 / 767.5 | 335.90 / 398.5 | 25.5% |
| 1939 | 258.00 / 589.1 | 455.20 / 867.8 | 312.35 / 638.5 | 31.4% |
| TNO | 215.40 / 1213.1 | 349.10 / 382.9 | 269.80 / 341.1 | 22.7% |

The new path improved this measured workload relative to full-frame raster, but all three medians still exceed native partial repaint. This is not evidence to enable raster automatically. These small hosted software-GPU samples are not Windows performance and must not be compared directly to R0-R2's different pointer-to-pixel/readback metric.

The last successful draw recorded in each block provides attribution examples, not full-sample quantiles. Full-raster target composition was 99.5-177.1 ms; retained capture was 13.8-29.2 ms and final target composition 0.2-0.4 ms. Corresponding total political-raster draw examples were 105.6-183.8 ms versus 21.5-37.7 ms. GPU submission wall time cannot be interpreted as GPU execution time. The end-to-end gap shows that optimizing this producer alone does not eliminate shared interaction and layer work.

### Navigation evidence and remaining bottleneck

All requested 130%/250%/100% zoom views settled back to raster and passed full-raster pixel equivalence. These are cold-view preparation/lifecycle observations, not warm FPS. Elapsed automation-to-settle values were roughly 2.97-8.84 s in the two HOI scenarios and 6.97-15.33 s in TNO. The worst observed rAF gap was about 2.17 s in TNO's return to 100%. Preserve this adverse evidence: the current navigation preparation is still not sufficient for default-on admission.

Final-runtime memory/DPR validation is run `38218492801`, pinned to `195f4991`. Real Shift-drag comparison is run `38219507804`, also pinned to `195f4991`. Their outcomes are recorded in the PR after inspection, not inferred from the earlier profile pass. A later documentation-only commit does not retroactively change which runtime was measured.

## Next execution order

Keep automatic raster disabled and preserve an explicit vector escape path. Before R5 asset production, use the new timing boundaries to investigate shared interaction/layer costs and first-time navigation/source preparation, particularly TNO. Profile first foreground edits separately from repeat recolors, because painter-order changes can invalidate coverage. Use warm/cold view separation and hardware graphics evidence instead of selecting favorable software-GPU samples. Then rebuild/version complete-display assets through the existing canonical geometry contract. Raster-first startup, broader perceptual/DPI settings and project/export release acceptance precede R6 default-on admission. Do not reduce quality, widen resource limits or reinterpret a functional pass as acceleration.
