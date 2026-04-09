# TNO Ready + Contour Repair - 2026-04-09

## Goal
- Make TNO 1962 enter a truthful ready/editable state once the scene is actually usable.
- Remove coarse-mode/status drift after detail promotion completes.
- Make terrain contours readable at low zoom and less harsh over dark political fills.

## Plan
- [ ] Fix scenario ready/editable state so post-ready overlay degradation does not masquerade as startup readonly.
- [ ] Align scenario status text and control availability with the real runtime state after detail promotion.
- [ ] Reduce contour clutter at low zoom and add automatic contour color adaptation against political fills.
- [ ] Add focused regression coverage and run targeted checks.
- [ ] Final review, update notes, archive this file.

## Progress
- [x] Root cause exploration completed for ready-state drift and contour visibility.
- [x] Scenario ready/editable logic updated so overlay-only hydration degradation no longer reuses `startupReadonly`.
- [x] Scenario status/control sync updated so detail promotion can clear stale coarse-mode status and degraded overlay state can surface explicit copy.
- [x] Contour density/color behavior updated with zoom profiles, major-line gating, screen-span filtering, and adaptive stroke color.
- [x] Regression coverage updated with `tests/e2e/tno_ready_state_contract.spec.js` and the tightened physical renderer regression.
- [x] Focused validation completed:
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/scenario_resources.js`
  - `node --check js/core/scenario_manager.js`
  - `node --check js/main.js`
  - `node --check tests/e2e/physical_layer_regression.spec.js`
  - `node --check tests/e2e/tno_ready_state_contract.spec.js`
  - `tests/e2e/physical_layer_regression.spec.js` passed
  - `tests/e2e/tno_ready_state_contract.spec.js` startup-ready assertion passed
  - `tests/e2e/tno_ready_state_contract.spec.js` overlay-only degradation assertion passed
  - manual browser probe on localhost confirmed `detailPromotionCompleted=true`, `topologyBundleMode="composite"`, `startupReadonly=false`, and clean TNO status text
- [x] Final review completed: keep atlas split, keep overlay-only degradation nonblocking, and accept contour host-color fallback as the remaining non-blocking visual edge case.
