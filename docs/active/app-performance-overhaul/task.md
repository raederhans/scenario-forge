# Task

Execute Phase 0 of app performance overhaul.

## Current owner
Main thread owns implementation and verification.
- [x] Patch rebuildStaticMeshes synchronous prewarm regression.
- [x] Patch chunk promotion infra static mesh rebuild regression.
- [x] Extend existing static tests for Phase 0 boundaries.
- [x] Add first-pass scenario water Path2D cache probe.
- [x] Run scoped deslop review on changed files; no additional cleanup edit needed.
- [x] Fix TNO manifest generated_at/baseline_hash to match checked-in startup bundles.
- [x] Post-deslop regression tests passed.
- [x] TNO water geometry test passed under WSL .venv.
- [x] perf:gate passed.
- [ ] Phase 1 refresh contract remains next.
- [ ] Phase 3 startup/HydrationPolicy remains next.
- [ ] Phase 4 UI fanout remains next.

## Phase 1 refresh contract slice
- [x] Add ScenarioRefreshPlan / RendererRefreshPlan bridge factories.
- [x] Route apply refresh through explicit renderer refresh plan.
- [x] Route startup hydration political refresh through startup-hydration plan.
- [x] Suppress duplicate opening-owner border refresh in apply post-effects.
- [x] Extend existing static and node contracts for refresh plan boundary.
- [x] Run scoped Phase 1 contract tests.

## Phase 1 review fixes
- [x] Fix fallback post-shell opening-owner border refresh ordering.
- [x] Make chunk promotion visual/deferred infra opening-owner refresh mutually exclusive.
- [x] Preserve opening-owner refresh policy across blocked infra reschedule.
- [x] Add static contract for blocked infra reschedule policy propagation.
- [x] Final reviewer confirmed the missing coverage is present.

## Review blocker fixes
- [x] Clear stale internal border mesh caches after political chunk promotion and let deferred border builder rebuild them.
- [x] Keep water Path2D rendering scoped to visible parts.
- [x] Add/update static contracts for both review comments.
- [x] Run affected JS/Python contract and behavior tests.
