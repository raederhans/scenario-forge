# Shared political raster: R0-R2 candidate

Source baseline: `b09a2e8e40895789924adee4305750fc642458d6`, source tree `b2edc4d7d1990a8264664ec22940d0cc65a19fcc`. Scope: complete political display coverage, explicit renderer strategy and observable same-document comparison. Automatic raster admission stays disabled.

## Modes and authority

`political_render_mode=raster` selects the persistent candidate, `vector` selects native compatibility, `auto` remains native during evaluation, and `hybrid` preserves the former trial for comparison. The old `political_id_raster=1` remains hybrid in this batch; `0` remains explicitly off. Modern URL, legacy URL, saved modern preference and saved legacy preference have that precedence. Invalid modes fail closed. The toolbar exposes the strategy and actual backend separately. Export, startup, river, unsupported-scenario and resource gates remain enforced.

The existing canonical feature IDs, editing actions, paint/history and project formats retain authority. Raster is disposable derived data, including noninteractive support features required by the native background. Those features are not made editable. Equal immutable full/fine geometry wrappers are recognized through exact content comparison cached by both objects. The known fragment-camouflage policy may deliberately prune interactive components while native background retains them. Only its marked, exact component subset with matching pruned count is admitted using the full display footprint; the original interactive geometry is never changed. Other shape conflicts fail closed. For this candidate, coordinate edits must replace the geometry objects and notify the existing source/coverage invalidation owner. Merely incrementing an unrelated revision while mutating the same geometry object is not a supported update contract. A color-only change with stable coverage/order updates the palette. A first paint which changes foreground order can invalidate affected tiles; it is not falsely reported as a palette-only operation.

## Rendering and diagnostic contracts

The persistent producer is attempted before native background/fine drawing. Only a completed validated raster pass skips those producers and cancels obsolete native background preparation. Missing coverage and resource failures keep native fallback. Persistent mode never schedules idle native refinement. Legacy hybrid keeps exact native refinement and its existing pixel oracle unchanged. No memory, timeout or recovery limit is enlarged.

`getPoliticalIdRasterDiagnostics()` includes `mode`, `effectiveMode`, `preferenceSource`, `actualBackend`, `sourceCoverage`, and cumulative `passes` counters. These distinguish primary raster, legacy mixed raster, native background/fine/fallback and native partial feedback. Counts are calls, not display FPS. Diagnostics do not schedule work. `runtimeVersion` identifies the candidate protocol, not a Git SHA; browser reports must supply the exact tested commit separately.

Complete coverage has a distinct asset scene identity (`:complete-display-v1`). Existing fine-only prebuilt manifests are not used for it. The candidate may cold-build new tiles and reuse its own validated persistent cache. No prebuilt scenario assets, startup bundles, source data, canonical formats or dependencies are regenerated. Raster-first startup and general quality/DPI tuning are R3-R6 work, not claimed here.

## Verification

Use the current locked dependencies. Focused Node tests cover policy precedence, unchanged defaults, source assembly, geometry/color distinction, idle/gesture persistence, cancellation, actual producer bypass, one-pass fallback and export/river protection. Current architecture assertions describe the new read-only API and gated primary branch; historical documents/baselines and the existing 280-line budget remain unchanged.

Browser check from a locally served Pages artifact:

```sh
node tools/verify_political_raster_resident.mjs --base-url http://127.0.0.1:8008/app/ --scenario hoi4_1939 --rounds 2 --revision <exact-commit>
```

Run each supported scenario separately. The check requires persistent raster after settling, exercises actual UI paint/41-point brush and undo/redo, verifies mode switching preserves document/history, and compares paired warm vector/raster samples plus the legacy hybrid path. Warm palette checks prohibit native background, native fine, native partial and coverage rebuilding. Cold activation/first foreground edits and navigation are separate lifecycle evidence, not warm performance. Pointer-to-correct-Canvas-pixel timing includes readback overhead and is not display presentation or INP. A hosted browser is not a Windows hardware-GPU benchmark. Visual screenshots remain candidate evidence, not the later R3 quality gate.

R0 release note: baseline #228 deployment was blocked by its existing first-recovery-probe fault assertion. This batch does not weaken or silently bypass that gate. A focused candidate run cannot be substituted for final required CI, artifact admission or deployed validation.

## Earlier failures and corrections

First real-artifact check exposed distinct full/fine geometry wrappers for `BY_INT_BREST` in all three scenarios. Reference inequality was not sufficient evidence of different coverage. The candidate compares immutable geometry contents once per object pair, retaining rejection for genuinely different shapes; the failure evidence is preserved. Native export is excluded from changing the visible-editor backend label. Current source proof hashes were refreshed only after the recorded root-state mutation comparison and declared current source-family checks; historical pins remain unchanged. An earlier broader mutation-discovery diagnostic reached its 120-second bound and is not reported as passed.

Second browser run (`38202016906`, candidate `2fc46b1e40e998d1c20bb804240d7e9d3a0d17b4`) exposed actual fragment pruning, not merely distinct wrappers: `BY_INT_BREST` full/fine byte lengths differ and the fine geometry omits complete components. All three candidates correctly fell back; no performance sample passed. Correction `3817897a94c8cd7857b073f6402be6ae3429e708` recognizes the existing marked component-subset policy and retains background coverage with the same canonical ID. Its full-footprint edge stroke can differ from the former pruned fine outline; this remains an approximate-display quality consideration, not a pixel-parity claim.

The release fault injector retains the recovery fault until a real owner probe timeout is observed, rather than spending it on an arbitrary late aborted HTTP callback. Existing recovery counts, deadlines and pixel assertions remain unchanged. Focused regressions cover the request-order issue; browser recovery verification is a separate check.

## Completed resident browser receipt, 2026-10-12

Tested runtime commit: `3817897a94c8cd7857b073f6402be6ae3429e708`.

- Independent read-only run: https://github.com/raederhans/scenario-forge/actions/runs/38204434010
- Evidence artifact: `raster-r0-r2-resume-evidence`, ID `11726782072`, archive SHA-256 `4d1620f515dbf2d938f099a50b4dcb9d6135c5c8869e104b36201c242c5da253`.
- Evidence receipt inspection: https://github.com/raederhans/scenario-forge/actions/runs/38205376790
- Environment: Ubuntu 24.04 hosted runner, locked Chromium, 1280x900 browser viewport, DPR 1. The built Pages directory was 983.54 MiB; that is deployment-directory size, not a per-visit download measurement.

All three resident verifier cases passed. Each covered actual paint, a 41-point continuous brush with one history entry, undo/redo, 130%/100% zoom settling, paired mode changes and preservation of canonical colors/history across mode changes. Each ended with actual backend `raster`, `complete-display-v1`, zero native idle refinements and no captured application errors. The tested warm palette blocks each produced six primary raster passes with zero native background/fine/partial calls and zero additional coverage builds. This zero-native statement is limited to those warm blocks: cold preparation, foreground-order changes, navigation cache misses and deliberate mode switches still legitimately used native fallback elsewhere in the lifecycle.

Each scenario's final same-document mode reactivation read 12 validated IndexedDB tiles and built zero tiles. It is not a cross-document startup A/B. First activation after an already-ready native view was 4.348 s (1939), 5.284 s (1936), and 9.363 s (TNO), including mode UI work and preparation. These values must not be presented as whole-page startup time.

The resume run also passed 59 focused source/policy/asset cases, a subset of the earlier 137-case focused suite. Do not add overlapping counts. `pr:plan` exited successfully with the correct merge base after retaining four commits of shallow history; it is planning only, not a test pass. Earlier planning failures did not indicate a successful complete workflow.

### Latency observation: not admitted as a speedup

Each numeric pair below is the first/second six-click block on the same page, in vector/raster/vector/raster order. These are the verifier's reported sample statistics, rounded to 0.1 ms, not robust population percentiles.

| Scenario | Vector reported median ms | Raster reported median ms | Vector reported P95 ms | Raster reported P95 ms |
|---|---|---|---|---|
| 1939 | 125.8 / 150.7 | 129.9 / 152.8 | 157.7 / 268.9 | 910.1 / 165.2 |
| 1936 | 138.3 / 145.7 | 137.1 / 117.9 | 179.4 / 553.7 | 635.5 / 798.7 |
| TNO | 119.4 / 108.4 | 102.0 / 112.8 | 154.8 / 162.1 | 142.2 / 180.7 |

The final hybrid comparison blocks reported medians 113.7/118.5/97.7 ms for 1939/1936/TNO, but each also performed 12 native background and 12 native fine passes plus six native partial repaints. Faster initial feedback alone does not establish lower total work or justify the hybrid architecture.

All three reports retain GPU `ReadPixels` stall warnings. Pixel-readback checks are useful correctness evidence but perturb the rendering workload. No FPS/INP, universal speedup, production Windows performance, or final perceptual-quality acceptance is inferred. The current evidence does not meet the agreed default-on performance objective. Preserve the slow samples rather than selecting a favorable run or raising a threshold.

## Delivery status and next decision

Core persistent-rendering functionality now has three-scenario browser evidence. R0-R2 release/performance acceptance is not complete. Keep PR #229 as a draft and keep automatic raster admission disabled. Required PR workflows last inspected at the tested runtime commit report `action_required`; independent bootstrap evidence neither satisfies nor bypasses them. No main merge or deployment has been performed.

Next work should profile source preparation, GPU submission, WebGL-to-Canvas composition and the remaining shared UI/layer work independently of repeated pixel readback. Recheck on Windows with hardware graphics, and add representative pan/zoom frame-time evidence before widening default eligibility. General visual/DPI tuning, new full-coverage prebuilt assets, raster-first startup, and native project/export integration acceptance remain explicitly separate work. Do not expand asset production merely because the functional tests passed.

Temporary source-transfer and validation workflows live only on the isolated bootstrap branch and are not part of the product diff. The receipt update changes documentation only; runtime/browser evidence remains pinned to the exact tested commit above.
