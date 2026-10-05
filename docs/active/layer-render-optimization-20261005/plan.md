# Plan

## Goal
Implement the three batches authorized after the layer-rendering audit: correctness, cache retention/invalidation, and continuous zoom presentation.

## Scope and sources of truth
Implement only the three reviewed layer batches. For delivery, extract their deltas into the managed `layer-render-delivery` checkout on `origin/main@06d09474`, preserving unrelated primary-workspace label/physical/thematic work. Root owns shared renderer integration, validation and Git operations. The user's subsequent instruction authorizes review, optimization, push and PR merge.

## Stages
1. Fix border angle/screen thresholds, transport line labels and collisions, city reveal discontinuity, contour-only invalidation, and antimeridian strategic geometry.
2. Account for retained raster/path owners; avoid allocating/retaining inactive pass canvases; bound duplicate geometry retention with existing correctness protections.
3. Bound navigation detail reuse by quality and coverage, separate screen-space labels where feasible, and verify continuous zoom/settle behavior.

## Acceptance criteria
- Audit counterexamples have focused behavior regressions and pass.
- Preserve painter order, color/selection semantics, exact export, identity fences, coverage gates, and atomic publication.
- Cache savings are supported by owner/canvas retention checks; do not describe estimates as browser heap measurements.
- Focused localhost browser validation of zoom and final display; targeted cross-module contracts for shared changes.

## Non-goals and risks
No data rebuild, manual production deployment, broad UI redesign, lowered detail/precision, or enlarged timeout/console allowlists. Existing physical fill order stays intact. Pre-existing WIP must not be reverted. Temporary evidence lives under .runtime/. Normal main-branch deployment may be triggered by the authorized merge; its result is reported separately.
