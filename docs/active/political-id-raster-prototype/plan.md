# Political ID raster — stages 1–11

## Goal and scope

Keep the shared 1936, 1939 and TNO scenario/vector/paint/project model. Stages 1–3 establish an isolated reproducible baseline, a derived geometry/palette adapter and a local switchable ID raster prototype. Follow-on stages 4–6 integrate an opt-in main-app renderer, multilevel caching and measured validation. Do not change scenario assets, replace picking or alter saved-project/export contracts. Default enablement is a separate evidence-based decision.

## Baseline

- Source: `98425dcc23ba6954e997df979788d4f06856cb76` (PR #216).
- Branch: `codex/political-id-raster-prototype`.
- Compare the same resolved features, D3 projection, painter order, fill/stroke policy, dimensions and DPR in a local browser harness.
- Three real scenario samples plus synthetic holes, overlapping edges, narrow polygons and seams. 1939 is the primary sample; 1936 is explicitly included in this harness because the standard performance runner does not support it.

## Stages and acceptance

1. Baseline and reproducible fixtures: record source identity, sampling bounds and baseline timing. Separate cold loading/build from warm recoloring and final 2D blit.
2. Derived source: stable codes, strict scene identity, independent geometry/palette revisions, old/new dirty bounds, removals and ordering; no canonical state writes.
3. Local browser prototype: integer IDs plus explicit edge coverage where required; palette edits and undo use the existing paint boundary. Compare native Canvas against GPU plus 2D output. Measure correctness, cold cost, warm cost and retained bytes. Preserve failure evidence; a failed quality/performance gate means no production enablement.

## Design constraints

- D3 retains spherical clipping, antimeridian handling and resampling.
- No interpolation of categorical IDs, no dropped edge contributors, no silent quality reduction.
- Native 0.75 CSS-pixel fill stroke is a raster-scale contract. This fixed-view prototype must rebuild when its projection/pixel scale/stroke policy changes; multilevel navigation is stage 5 of the larger plan.
- Adapter accepts final visual collections; the standalone fixtures are explicitly a subset, not evidence of complete application startup or TNO overlay integration.
- Cache identities must include paint ordering and coverage policy. Color-only changes with unchanged ordering must build zero geometry tiles; a first override that promotes a feature in the existing foreground order requires local invalidation.
- CPU ID data, sparse coverage data, GPU copies, output surfaces and temporary masks are reported separately as estimates, not heap/VRAM measurements.
- No deployment, push or merge is in this request.

## Quality decision after initial measurement

The user explicitly allowed a small raster quality reduction. Preserve the original strict gate (GPU/oracle <= 1 byte, native comparison <= 3 bytes, direct-code interiors exact). Add a separate approximate-quality gate before the next run: average per-pixel maximum channel difference <= 0.75/255, at most 0.2% of pixels with a channel difference > 32/255, and <= 1 byte difference for solid interiors with the same direct ID throughout a 5x5 neighborhood. Palette/undo/staleness/owner invariants remain exact. These are prototype engineering criteria, not a user-approved final visual specification.

Initial real-browser evidence separated hardware Canvas antialiasing from CPU-mask antialiasing. Independent tile surfaces also changed coverage at seams. Build a single bounded local raster region and split its ID/coverage arrays, with an exact monolithic-versus-split oracle gate; do not silently accept avoidable seams. This increases temporary region memory and is not yet a world-scale or pan/zoom solution.

## Verification

Use bounded Node behavior tests for the adapter and tile encoding. Use real WebGL2/Canvas browser checks for pixels, palette edits, undo, stale results and fallback. Compare warm paired samples without confusing shader submission with presentation or whole-app FPS. Keep transient evidence in `.runtime/`.

## Follow-on authorization: stages 4–6

The user subsequently authorized the remaining three stages, retaining the small quality-loss allowance. Earlier sections describe the completed prototype batch; the production-import restriction applied to that batch only.

4. Integrate an opt-in political fine-pass producer behind `political_id_raster=1`. Preserve the existing background and overlay order; prevent duplicate fine-raster producers. Keep river-partition ordering, picking, canonical edits, project persistence and export with their existing owners. Commit only complete, current coverage with the latest palette.
5. Use projected-space tiles at quarter-octave physical resolution, viewport plus a snapped edge margin, local old/new geometry-bound invalidation, and a byte-bounded CPU LRU. Resample resolved RGBA only. At intermediate zoom the 0.75 CSS-pixel raster stroke is between approximately 0.63 and 0.75 pixels; geometry/identity remain exact. CPU tiles and GPU estimates are separate. Geometry construction runs in a cancellable worker.
6. Verify real application rendering and edit/persistence/export behavior, unsupported/lost GPU fallback, navigation reuse, local promotion, cold/warm cost and bounded resource retention. Decide default enablement from measured evidence; opt-in remains the safe outcome if gains or visual quality are not demonstrated. Prebuilt assets and raster picking remain deferred.

## Follow-on authorization: stages 7–11

The user authorized all five next steps and bounded delegation. Preserve vector geometry, scenario contracts and canonical editing/export. Complete stage 7 actual-application comparison and error attribution; stage 8 projected-path reuse and measured seam/scale refinements; stage 9 stable world coordinates and a reproducible two-level 1939 asset pilot with 1936/TNO compatibility; stage 10 conservative CPU picking; stage 11 asset-first tile reuse and persistent storage integrated with the existing deferred-vector mechanism. Asset errors, incompatible geometry/ordering, missing coverage and ambiguous picking fall back to the current path. Experimental generated assets stay in .runtime until production asset admission is separately justified. Do not claim startup or interaction gains from isolated full-topology fixtures.
