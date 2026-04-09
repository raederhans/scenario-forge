# Physical Layer Order Repair - 2026-04-09

## Goal
- Make the heavy fill-based physical atlas stop rendering above political in the final visible stack.
- Keep physical readable by retaining only the lightest contour cue above political instead of trying to sink every physical element.
- Close the renderer ownership chain so pass signature, invalidation, exact refresh, and regression coverage match the new split ownership.

## Plan
- [x] Make `physicalBase` the only pass that renders fill-based physical atlas content.
- [x] Remove physical atlas drawing responsibility from `contextBase` while keeping the lightest readable contour cue above `political`.
- [x] Tighten regression coverage for the new owning-pass contract.
- [x] Run targeted verification allowed by the no-long-test constraint, do final review, then archive this note.

## Progress
- [x] Root cause confirmed: `contextBase` was still drawing physical atlas/contours after `political`.
- [x] Tradeoff confirmed from code: `political` fill is fully opaque, so sinking atlas+contours completely below it would make physical effectively disappear.
- [x] Minimal viable direction chosen: move atlas ownership below `political`, keep contours above as the lightest readable physical cue.
- [x] Renderer + regression contract updated for the new split ownership.
- [x] Static checks passed: `node --check js/core/map_renderer.js`, `node --check tests/e2e/physical_layer_regression.spec.js`.
- [x] Targeted Playwright regression passed: `tests/e2e/physical_layer_regression.spec.js`.
- [x] Final review completed under the no-long-test constraint; broader live visual regression is left for manual/local verification.
