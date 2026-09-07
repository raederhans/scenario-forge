from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RENDERER_RUNTIME_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "renderer_runtime_state.js"
RENDERER_INTERACTION_ACTIONS_JS = REPO_ROOT / "js" / "core" / "state" / "actions" / "renderer_interaction_actions.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SIDEBAR_JS = REPO_ROOT / "js" / "ui" / "sidebar.js"
SPATIAL_INDEX_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_owner.js"
SPATIAL_INDEX_RUNTIME_STATE_OPS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_state_ops.js"
SPATIAL_INDEX_RUNTIME_DERIVATION_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_derivation.js"


class RendererRuntimeStateBoundaryContractTest(unittest.TestCase):
    def test_renderer_runtime_state_owner_exports_shared_factories(self):
        owner_content = RENDERER_RUNTIME_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultRendererInfrastructureState", owner_content)
        self.assertIn("createDefaultRenderPassCacheState", owner_content)
        self.assertIn("createDefaultSidebarPerfState", owner_content)
        self.assertIn("createDefaultProjectedBoundsCacheState", owner_content)
        self.assertIn("createDefaultProjectedBoundsDiagnostics", owner_content)
        self.assertIn("createDefaultRendererTransientRuntimeState", owner_content)
        self.assertIn("ensureRenderPassCacheState", owner_content)
        self.assertIn("ensureProjectedBoundsCacheState", owner_content)
        self.assertIn("ensureSceneSnapshotState", owner_content)
        self.assertIn("bumpSceneGenerationState", owner_content)
        self.assertIn("bumpScenarioDataGenerationState", owner_content)
        self.assertIn("ensureSidebarPerfState", owner_content)
        self.assertIn("resetProjectedBoundsCacheState", owner_content)
        self.assertNotIn("ensureSphericalFeatureDiagnosticsCache", owner_content)
        self.assertIn("./actions/renderer_cache_actions.js", owner_content)
        for retired in (
            "commitRendererDprStageState",
            "setFirstVisibleFramePaintedState", "commitProjectedBoundsDiagnosticsState",
        ):
            self.assertNotIn(retired, owner_content)
        self.assertIn("applyRendererSurfaceBridgeState", owner_content)

        action_content = RENDERER_INTERACTION_ACTIONS_JS.read_text(encoding="utf-8")
        self.assertIn("setInteractionInfrastructureStateFields", action_content)

    def test_map_renderer_reuses_renderer_runtime_factories(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn("./state/renderer_runtime_state.js", content)
        self.assertIn("ensureProjectedBoundsCacheState(runtimeState);", content)
        self.assertIn("createDefaultProjectedBoundsDiagnostics()", content)
        self.assertRegex(
            content,
            r"(?s)renderCacheOwner = createRenderCacheOwner\(\{"
            r".*?helpers:\s*\{.*?ensureRenderPassCacheState,",
        )
        self.assertIn("ensureSidebarPerfState(state)", content)
        self.assertIn("resetProjectedBoundsRuntimeCacheState(state);", content)
        self.assertIn("clearSphericalFeatureDiagnosticsCacheState(runtimeState)", content)
        self.assertIn("getSphericalFeatureDiagnosticsCacheEntryState(runtimeState, resolvedFeatureId)", content)
        self.assertIn("setSphericalFeatureDiagnosticsCacheEntryState(runtimeState, resolvedFeatureId, diagnostics)", content)
        self.assertIn("./state/actions/renderer_interaction_actions.js", content)
        self.assertIn("setInteractionInfrastructureStateFields(state, stage,", content)
        self.assertIn("ensureSceneSnapshotState(runtimeState)", content)
        self.assertIn("bumpSceneGenerationState(runtimeState", content)
        self.assertIn("applyRendererSurfaceBridgeState(runtimeState, {", content)
        self.assertNotIn("runtimeState.colorCanvas = rendererSurfaceHost.getMapCanvas()", content)
        self.assertNotIn("runtimeState.lineCanvas = null", content)
        self.assertNotIn("runtimeState.lineCtx = null", content)

    def test_dev_selection_overlay_merges_selected_feature_boundary(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner = (MAP_RENDERER_JS.parent / "renderer" / "selection_overlay_owner.js").read_text(encoding="utf-8")
        self.assertIn("getSelectionOverlayOwner().renderDevSelectionOverlay()", content)
        self.assertIn("getSelectionOverlayOwner().renderDevSelectionOverlayIfNeeded({ force })", content)
        render_body = owner.split("function renderDevSelectionOverlay() {", 1)[1].split(
            "function renderDevSelectionOverlayIfNeeded", 1
        )[0]

        self.assertIn("const overlayData = buildDevSelectionOverlayData(orderedIds, data);", render_body)
        self.assertIn(".data(overlayData,", render_body)
        self.assertIn('.attr("stroke-width", 1.35);', render_body)
        self.assertIn("function buildDevSelectionOverlayData(orderedIds, fallbackFeatures) {", owner)
        self.assertIn("geometriesById.size !== selectedIds.size", owner)
        self.assertIn("topojson.merge(topology, featureIds.map((id) => geometriesById.get(id)))", owner)
        self.assertIn('devSelectionKey: `merged:${JSON.stringify(featureIds)}`', owner)
        self.assertIn('selectionGeometry: "topology-boolean-merge"', owner)
        self.assertIn("Number(runtimeState.topologyRevision || 0)", content)

    def test_sidebar_reuses_sidebar_perf_factory(self):
        content = SIDEBAR_JS.read_text(encoding="utf-8")

        self.assertIn("../core/state/renderer_runtime_state.js", content)
        self.assertIn("ensureSidebarPerfState(state)", content)

    def test_spatial_runtime_owner_uses_scoped_state_ops_and_derivation_modules(self):
        owner_content = SPATIAL_INDEX_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        state_ops_content = SPATIAL_INDEX_RUNTIME_STATE_OPS_JS.read_text(encoding="utf-8")
        derivation_content = SPATIAL_INDEX_RUNTIME_DERIVATION_JS.read_text(encoding="utf-8")

        self.assertIn("./spatial_index_runtime_state_ops.js", owner_content)
        self.assertIn("./spatial_index_runtime_derivation.js", owner_content)
        self.assertIn("clearPrimaryIndexMaps(state);", owner_content)
        self.assertIn("resetPrimarySpatialState(state);", owner_content)
        self.assertIn("applyPrimarySpatialSnapshot(state, {", owner_content)
        self.assertIn("applySecondarySpatialSnapshot(state, {", owner_content)
        self.assertIn("cacheFeatureBounds(feature, id);", owner_content)
        self.assertIn("createSpatialIndexPerfPayload({", owner_content)
        self.assertIn("export function clearPrimaryIndexMaps(state) {", state_ops_content)
        self.assertIn("export function resetPrimarySpatialState(state) {", state_ops_content)
        self.assertIn("export function resetSecondarySpatialState(state) {", state_ops_content)
        self.assertIn("export function applyPrimarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function applySecondarySpatialSnapshot(state, {", state_ops_content)
        self.assertNotIn("deriveRuntimePrimaryFeaturePayload", derivation_content)
        self.assertIn("export function createSpatialIndexPerfPayload({", derivation_content)


if __name__ == "__main__":
    unittest.main()
