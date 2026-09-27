from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SCENARIO_REFRESH_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_runtime.js"
SPATIAL_INDEX_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_owner.js"
SPATIAL_INDEX_RUNTIME_BUILDERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_builders.js"
SPATIAL_INDEX_RUNTIME_STATE_OPS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_state_ops.js"
SPATIAL_INDEX_RUNTIME_DERIVATION_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_derivation.js"


class MapRendererSpatialIndexRuntimeOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_interaction_startup_orchestration_while_calling_spatial_owner_directly(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        refresh_runtime_content = SCENARIO_REFRESH_RUNTIME_JS.read_text(encoding="utf-8")
        owner_content = SPATIAL_INDEX_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        builders_content = SPATIAL_INDEX_RUNTIME_BUILDERS_JS.read_text(encoding="utf-8")
        state_ops_content = SPATIAL_INDEX_RUNTIME_STATE_OPS_JS.read_text(encoding="utf-8")
        derivation_content = SPATIAL_INDEX_RUNTIME_DERIVATION_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createSpatialIndexRuntimeOwner } from './renderer/spatial_index_runtime_owner.js';", renderer_imports)
        self.assertNotIn("facade_spatial_runtime.js", renderer_content)
        self.assertIn("let spatialIndexRuntimeOwner = null;", renderer_content)
        self.assertIn("function getSpatialIndexRuntimeOwner() {", renderer_content)
        self.assertIn("rebuildAuxiliaryRegionIndexes,", renderer_content)
        self.assertIn("getLogicalCanvasDimensions,", renderer_content)
        self.assertIn("getProjectedFeatureBounds,", renderer_content)
        self.assertIn("hitGridTargetCols: HIT_GRID_TARGET_COLS,", renderer_content)
        self.assertIn("hitGridMinCellPx: HIT_GRID_MIN_CELL_PX,", renderer_content)
        self.assertIn("hitGridMaxCellPx: HIT_GRID_MAX_CELL_PX,", renderer_content)
        self.assertIn("hitMaxCellsPerItem: HIT_MAX_CELLS_PER_ITEM,", renderer_content)
        self.assertIn("import { getSpatialBucketKey } from \"./renderer/spatial_index_runtime_builders.js\";", renderer_content)
        self.assertNotIn("function buildSpatialGrid(", renderer_content)
        self.assertIn("setInteractionInfrastructureState,", renderer_content)
        self.assertIn("yieldToMain,", renderer_content)
        self.assertIn("getFeatureBorderMeshCountryCodeNormalized,", renderer_content)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+resetSecondarySpatialIndexState\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+resetSecondarySpatialIndexState\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+buildSecondarySpatialIndexes\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+buildSecondarySpatialIndexes\s*\(", renderer_content))
        combined_runtime_content = f"{renderer_content}\n{refresh_runtime_content}"
        self.assertEqual(combined_runtime_content.count("getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState({"), 3)
        self.assertEqual(combined_runtime_content.count("preserveCurrent: true"), 3)
        self.assertEqual(combined_runtime_content.count("getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes({"), 3)
        self.assertIn("function rebuildRuntimeDerivedState({", renderer_content)
        self.assertIn("async function buildBasicInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("async function buildFullInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("function initMap({", renderer_content)
        self.assertIn("function setMapData({", renderer_content)
        self.assertIn("scenarioRefreshRuntime = createScenarioRefreshRuntime({", renderer_content)
        self.assertIn("function refreshMapDataForScenarioApply(options = {})", renderer_content)
        self.assertIn("function refreshMapDataForScenarioApply({", refresh_runtime_content)
        self.assertIn("function resetRendererRefreshTransactionState({", renderer_content)
        set_map_data_start = renderer_content.index("function setMapData({")
        refresh_transaction_start = renderer_content.index("function resetRendererRefreshTransactionState({")
        scenario_apply_start = refresh_runtime_content.index("function refreshMapDataForScenarioApply({")
        set_map_data_body = renderer_content[set_map_data_start:refresh_transaction_start]
        scenario_apply_body = refresh_runtime_content[
            scenario_apply_start:refresh_runtime_content.index("\n  return {", scenario_apply_start)
        ]
        refresh_transaction_body = renderer_content[
            refresh_transaction_start:renderer_content.index(
                "\nscenarioRefreshRuntime = createScenarioRefreshRuntime(",
                refresh_transaction_start,
            )
        ]
        transaction_content = (MAP_RENDERER_JS.parent / "map_renderer" / "set_map_data_transaction_owner.js").read_text(encoding="utf-8")
        reset_content = (MAP_RENDERER_JS.parent / "map_renderer" / "renderer_transaction_reset_owner.js").read_text(encoding="utf-8")
        scheduling_content = (MAP_RENDERER_JS.parent / "map_renderer" / "hit_canvas_scheduling_owner.js").read_text(encoding="utf-8")
        binding_start = renderer_content.index("function getSetMapDataTransactionOwner() {")
        transaction_binding = renderer_content[binding_start:renderer_content.index("  return setMapDataTransactionOwner;\n}", binding_start)]
        reset_binding_start = renderer_content.index("function getRendererTransactionResetOwner() {")
        reset_binding = renderer_content[reset_binding_start:renderer_content.index("function getMapHoverInteractionOwner()", reset_binding_start)]
        self.assertIn("setMapDataTransactionOwner = createSetMapDataTransactionOwner({", transaction_binding)
        self.assertRegex(set_map_data_body, r"return getSetMapDataTransactionOwner\(\)\.runSetMapDataTransaction\(\{\s*refitProjection,\s*resetZoom,\s*suppressRender,\s*interactionLevel,\s*deferInteractionInfrastructure,\s*\}\);")
        for effect in ("resetRendererTransactionState", "clearLastGoodFrame", "invalidateAllRenderPasses", "setCanvasSize", "buildRuntimePoliticalMeta"):
            self.assertIn(f"      {effect},", transaction_binding)
        self.assertIn('const SET_MAP_DATA_REASON = "set-map-data";', transaction_content)
        self.assertRegex(transaction_content, r'runEffect\("resetRendererTransactionState", \{\s*cancelHoverOverlayRender: true,\s*cancelSecondarySpatialBuild: true,\s*\}\);')
        self.assertIn('runEffect("clearLastGoodFrame", SET_MAP_DATA_REASON);', transaction_content)
        self.assertIn('runEffect("invalidateAllRenderPasses", SET_MAP_DATA_REASON);', transaction_content)
        self.assertRegex(transaction_binding, r"sanitizeSetMapDataColorState: \(\) => \{\s*"
                         r"runtimeState\.sovereignBaseColors = sanitizeCountryColorMap\(runtimeState\.sovereignBaseColors\);\s*"
                         r"runtimeState\.visualOverrides = sanitizeColorMap\(runtimeState\.visualOverrides\);\s*"
                         r"runtimeState\.waterRegionOverrides = sanitizeColorMap\(runtimeState\.waterRegionOverrides\);\s*"
                         r"runtimeState\.specialRegionOverrides = \{\};")
        self.assertRegex(transaction_content, r'runEffect\("sanitizeSetMapDataColorState"\);\s*runEffect\("setCanvasSize"\);\s*runEffect\("buildRuntimePoliticalMeta"\);')
        self.assertIn("resetRendererTransactionState({ hitCanvasDirty: true });", scenario_apply_body)
        self.assertRegex(refresh_transaction_body, r"return getRendererTransactionResetOwner\(\)\.resetRendererRefreshTransactionState\(\{\s*cancelHoverOverlay,\s*cancelSecondarySpatialBuild,\s*\}\);")
        refresh_start = reset_content.index("  function resetRendererRefreshTransactionState({")
        refresh_body = reset_content[refresh_start:reset_content.index("  function markRendererTopologyChanged({", refresh_start)]
        self.assertNotIn("getRenderPassCacheState()", refresh_body)
        self.assertNotIn("topologyRevision", refresh_body)
        reset_order = [
            "clearPendingDynamicBorderTimer", "clearRenderPhaseTimer", "cancelPendingIndexUiRefresh",
            "cancelPendingSidebarRefresh", "cancelScheduledHoverOverlayRender", "setRenderPhaseIdle",
            "resetRenderDiagnostics", "clearStagedMapDataTasks", "cancelExactAfterSettleRefresh",
            "cancelScheduledHitCanvasBuild", "cancelSecondarySpatialBuild", "setDeferContextBasePass",
            "setDeferHitCanvasBuild", "setDeferExactAfterSettle", "resetLayerResolverCache",
            "resetDevInteractionState", "resetDevClipboardState", "resetPhysicalLandClipPathCache",
        ]
        positions = [refresh_body.index(f'runEffect(trace, "{effect}"') for effect in reset_order]
        self.assertEqual(positions, sorted(positions))
        for effect in reset_order:
            self.assertRegex(reset_binding, rf"\b{effect}(?:,|:)")
        self.assertIn("rendererTransactionResetOwner = createRendererTransactionResetOwner({", reset_binding)
        self.assertRegex(refresh_body, r'if \(cancelHoverOverlay\) \{\s*runEffect\(trace, "cancelScheduledHoverOverlayRender"\);\s*\}')
        self.assertRegex(refresh_body, r'const canceledSecondarySpatial = cancelSecondarySpatialBuild\s*\? runEffect\(trace, "cancelSecondarySpatialBuild"\) !== false\s*: false;')
        self.assertIn("setRenderPhaseIdle: () => setRenderPhase(RENDER_PHASE_IDLE)", reset_binding)
        self.assertRegex(reset_binding, r"cancelDeferredWork\(secondarySpatialBuildHandle\);\s*secondarySpatialBuildHandle = null;\s*pendingSecondarySpatialBuildReasons\.clear\(\);")
        self.assertIn("getHitCanvasSchedulingOwner().cancelScheduledHitCanvasBuild(options)", reset_binding)
        self.assertRegex(scheduling_content, r'runEffect\(trace, "cancelDeferredWork", scheduledHandle\);\s*runEffect\(trace, "setScheduledHitCanvasBuildHandle", null\);')
        self.assertIn("getScheduledHitCanvasBuildHandle: () => runtimeState.hitCanvasBuildScheduled", renderer_content)
        self.assertIn("setHitCanvasBuildScheduledState(runtimeState, handle);", renderer_content)
        for field in ("ContextBasePass", "HitCanvasBuild", "ExactAfterSettle"):
            self.assertIn(f'runEffect(trace, "setDefer{field}", false);', refresh_body)
        self.assertIn("runtimeState.deferContextBasePass = Boolean(deferred);", reset_binding)
        self.assertIn("runtimeState.deferHitCanvasBuild = Boolean(deferred);", reset_binding)
        self.assertIn("setDeferExactAfterSettleState(runtimeState, deferred);", reset_binding)
        for statement in (
            "layerResolverCache.primaryRef = null;", "layerResolverCache.detailRef = null;",
            "layerResolverCache.bundleMode = null;", "layerResolverCache.contextRevision = 0;",
            "runtimeState.devHoverHit = null;", "runtimeState.devSelectedHit = null;",
            "runtimeState.devSelectionFeatureIds = new Set();", "runtimeState.devSelectionOrder = [];",
            'runtimeState.devClipboardFallbackText = "";', 'runtimeState.devClipboardPreviewFormat = "names_with_ids";',
        ):
            self.assertIn(statement, reset_binding)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildIndex(...args);", renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildSpatialIndex(...args);", renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildIndexChunked(...args);", renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildSpatialIndexChunked(...args);", renderer_content)

        self.assertIn("export function createSpatialIndexRuntimeOwner({", owner_content)
        self.assertIn("appendLandIndexEntriesRange", owner_content)
        self.assertIn("appendLandSpatialItemsRange", owner_content)
        self.assertIn("captureSpatialGridBuild", owner_content)
        self.assertNotIn("buildSpatialGrid = () => {}", owner_content)
        self.assertIn("getFeatureBorderMeshCountryCodeNormalized = () => \"\",", owner_content)
        self.assertIn("./spatial_index_runtime_state_ops.js", owner_content)
        self.assertIn("./spatial_index_runtime_derivation.js", owner_content)
        self.assertIn("function buildIndex({ scheduleUiMode = \"immediate\" } = {}) {", owner_content)
        self.assertIn("function rebuildRuntimePrimaryIndex({", owner_content)
        self.assertIn("function resetSecondarySpatialIndexState({", owner_content)
        self.assertIn("markSecondarySpatialBuildPending(state, {", owner_content)
        self.assertIn("function buildSecondarySpatialIndexes({", owner_content)
        self.assertIn("function buildSpatialIndex({", owner_content)
        self.assertIn("async function buildIndexChunked({", owner_content)
        self.assertIn("async function buildSpatialIndexChunked({", owner_content)
        self.assertIn("clearPrimaryIndexMaps(state);", owner_content)
        self.assertIn("applyPrimarySpatialSnapshot(state, {", owner_content)
        self.assertIn("applySecondarySpatialSnapshot(state, {", owner_content)
        self.assertIn("createSpatialIndexPerfPayload({", owner_content)
        self.assertIn("spatialGridCells: state.spatialGrid?.size || 0,", owner_content)
        self.assertIn("waterGridCells: state.waterSpatialGrid?.size || 0,", owner_content)
        self.assertIn("specialGridCells: state.specialSpatialGrid?.size || 0,", owner_content)
        self.assertIn("cacheFeatureBounds(feature, id);", owner_content)
        self.assertNotIn("function rebuildRuntimeDerivedState({", owner_content)
        self.assertIn("getProjectedFeatureBounds(feature, {", builders_content)
        self.assertIn("borderMeshCountryCode: resolveBorderMeshCountryCode(feature),", builders_content)
        self.assertIn("typeof getFeatureBorderMeshCountryCodeNormalized === \"function\"", builders_content)
        self.assertIn("function captureSpatialGridBuild(", builders_content)
        self.assertIn("export function buildSpatialGridSnapshot({", builders_content)
        self.assertIn("export function getSpatialBucketKey(col, row) {", builders_content)

        self.assertIn("export function clearPrimaryIndexMaps(state) {", state_ops_content)
        self.assertIn("export function resetPrimarySpatialState(state) {", state_ops_content)
        self.assertIn("export function resetSecondarySpatialState(state) {", state_ops_content)
        self.assertIn("export function applyPrimarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function applySecondarySpatialSnapshot(state, {", state_ops_content)
        self.assertNotIn("deriveRuntimePrimaryFeaturePayload", derivation_content)
        self.assertIn("export function createSpatialIndexPerfPayload({", derivation_content)
        self.assertIn("spatialGridCells = 0,", derivation_content)
        self.assertIn("waterGridGlobals = 0,", derivation_content)
        self.assertIn("specialGridGlobals = 0,", derivation_content)


if __name__ == "__main__":
    unittest.main()
