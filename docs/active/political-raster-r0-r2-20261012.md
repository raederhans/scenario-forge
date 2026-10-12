# Shared political raster: R0-R2 candidate

Source baseline: `b09a2e8e40895789924adee4305750fc642458d6`, source tree `b2edc4d7d1990a8264664ec22940d0cc65a19fcc`. Scope: complete political display coverage, explicit renderer strategy and observable same-document comparison. Automatic raster admission stays disabled.

## Modes and authority

`political_render_mode=raster` selects the persistent candidate, `vector` selects native compatibility, `auto` remains native during evaluation, and `hybrid` preserves the former trial for comparison. The old `political_id_raster=1` remains hybrid in this batch; `0` remains explicitly off. Modern URL, legacy URL, saved modern preference and saved legacy preference have that precedence. Invalid modes fail closed. The toolbar exposes the strategy and actual backend separately. Export, startup, river, unsupported-scenario and resource gates remain enforced.

The existing canonical feature IDs, editing actions, paint/history and project formats retain authority. Raster is disposable derived data, including noninteractive support features required by the native background. Those features are not made editable. Conflicting full/fine geometries for the same ID fail closed rather than silently removing background coverage. Geometry objects must be replaced, or the existing geometry/coverage revision contract advanced when coordinates change. A color-only change with stable coverage/order updates the palette. A first paint which changes foreground order can invalidate affected tiles; it is not falsely reported as a palette-only operation.

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

Run each supported scenario separately. The check requires persistent raster after settling, exercises actual UI paint/41-point brush and undo/redo, verifies mode switching preserves document/history, and compares paired warm vector/raster samples plus the legacy hybrid path. Warm palette checks prohibit native background, native fine, native partial and coverage rebuilding. Cold activation/first foreground edits and navigation are separate lifecycle evidence, not warm performance. Pointer-to-correct-Canvas-pixel timing includes readback overhead and is not display presentation or INP. A hosted software GPU is not a Windows hardware-GPU benchmark. Visual screenshots remain candidate evidence, not the later R3 quality gate.

R0 release note: baseline #228 deployment was blocked by its existing first-recovery-probe fault assertion. This batch does not weaken or silently bypass that gate. A focused candidate run cannot be substituted for final required CI, artifact admission or deployed validation.

## Delivery status

Implementation and local focused tests recorded during this task. Browser and final-head CI outcomes are recorded in the PR and task result, not assumed by this document. No main merge or deployment is authorized by candidate creation. Temporary source-transfer workflows live only on the isolated bootstrap branch and are not part of the product diff.
