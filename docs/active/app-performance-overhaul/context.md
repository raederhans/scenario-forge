# Context

Started 2026-04-24. Current plan is v3. Parent owns tests; subagents static analysis only.

## 2026-04-24 Phase 0 implementation notes
- Removed synchronous viewport province/local border mesh prewarm from rebuildStaticMeshes; heavy internal border meshes remain deferred by draw owner.
- Removed rebuildStaticMeshes from chunk promotion infra stage; full scenario apply still owns static mesh rebuild.
- Added static contracts for the two boundaries.

## 2026-04-24 Phase 2 water cache probe
- Added Path2D-backed scenario water feature/path cache for fill rendering, cleared with projected bounds cache.
- Static water contract extended under tests/scenario_chunk_contracts.test.mjs.

## 2026-04-24 Deslop pass
Scope: js/core/map_renderer.js, data/scenarios/tno_1962/manifest.json, tests/scenario_chunk_contracts.test.mjs, tests/test_map_renderer_border_mesh_owner_boundary_contract.py, tests/test_scenario_chunk_refresh_contracts.py.
Behavior lock: static contracts, perf:gate, TNO water geometries.
Review result: current changes are minimal and targeted. No extra abstraction introduced; no cleanup edit needed after deslop review.

## 2026-04-24 Verification evidence
- Static/contracts: Python contract suite 21 tests passed; scenario_chunk_contracts passed; border_mesh_owner_behavior passed; perf_probe_snapshot_behavior passed; node --check map_renderer passed.
- TNO water geometry: WSL .venv pytest 	ests/test_tno_water_geometries.py -q passed 16/16 after aligning checked-in manifest generated_at/baseline_hash with startup bundles.
- Perf: perf:gate passed; focused baselines show blank_base rebuildStaticMeshes 248.3ms, TNO promotion infra 13.6ms, TNO water fill 100.4ms, TNO contextScenario 223.4ms.

## 2026-04-24 Phase 1 refresh contract slice
- Added ScenarioRefreshPlan / RendererRefreshPlan factories in scenario_renderer_bridge.js for apply, chunk promotion, and startup hydration.
- Renderer refresh functions now accept refreshPlan and normalize target passes, opening-owner border refresh, and water-cache reset reason.
- Post-apply now suppresses duplicate opening-owner refresh in renderer refresh and shell overlay, then runs one explicit opening-owner refresh after shell overlay. Fallback setMapData path keeps its existing opening-owner refresh and skips the explicit duplicate.
- Startup hydration political refresh now passes startup-hydration refreshPlan through the bridge.
- Contracts extended in test_scenario_renderer_bridge_boundary_contract.py, test_scenario_chunk_refresh_contracts.py, test_startup_hydration_boundary_contract.py, test_map_renderer_border_mesh_owner_boundary_contract.py, startup_hydration_behavior.test.mjs.
- Verification: node --check target files passed; Python phase1 contract suite 25/25 passed; startup-hydration behavior passed; scenario-chunk-contracts passed; border-mesh-owner-behavior passed; perf-probe-snapshot-behavior passed.

## 2026-04-24 Phase 1 static review follow-up
- Static review scope: js/core/map_renderer.js, js/core/scenario/scenario_renderer_bridge.js, js/core/scenario/startup_hydration.js, js/core/scenario_post_apply_effects.js, js/core/scenario_shell_overlay.js, related Phase 1 tests.
- Confirmed risk 1: chunk promotion still refreshes opening-owner borders twice when political payload changes and opening_owner_borders mesh pack is usable. Visual stage sync at map_renderer.js:22217-22225 and deferred infra stage refresh at map_renderer.js:22077-22083 both fire.
- Confirmed risk 2: setMapData fallback path skips the post-shell explicit opening-owner refresh after scenario_shell_overlay may bump scenarioShellOverlayRevision. runPostScenarioApplyEffects marks fallback as already refreshed at scenario_post_apply_effects.js:252-260, then skips the post-overlay refresh at 268-269.
- Coverage gap: existing contracts assert apply-path wiring and startup-hydration injection, but they do not lock the fallback post-shell path, chunk-promotion single-refresh behavior, or startup-hydration null-plan branch.

## 2026-04-24 Phase 1 review fix
- Reviewer found two blockers: fallback post-apply opening-owner borders could become stale after shell overlay, and chunk promotion could refresh opening-owner borders in both visual and deferred infra stages.
- Fixed fallback by always running one explicit opening-owner refresh after shell overlay.
- Fixed chunk promotion by computing shouldRefreshOpeningOwnerBordersInVisual and passing the opposite policy into deferred infra, including blocked-infra reschedule.
- Added contract coverage for blocked infra reschedule preserving reason, suppressRender, promotionVersion, hasPoliticalGeometryChange, refreshOpeningOwnerBorders.
- Final static reviewer confirmed PASS for the missing test coverage.

## 2026-04-24 Review blocker fix
- Fixed political chunk promotion stale internal border meshes by clearing province/local/detailAdm border mesh caches, refreshing source country sets, syncing the static mesh snapshot, and scheduling deferred heavy border mesh rebuild before the visual render can reuse old meshes.
- Fixed scenario water Path2D drawing to use the combined feature path only when all safe parts are visible; partial visibility now fills cached per-part Path2D objects and falls back to pathCanvas per missing part.
- Verification: node --check js/core/map_renderer.js passed; Python refresh contract suite 18/18 passed; combined Python Phase 1 contract suite 28/28 passed; scenario-chunk-contracts passed; border-mesh-owner-behavior passed; perf-probe-snapshot-behavior passed; startup-hydration-behavior passed.
