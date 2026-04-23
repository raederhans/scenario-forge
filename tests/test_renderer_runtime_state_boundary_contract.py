from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RENDERER_RUNTIME_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "renderer_runtime_state.js"
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
        self.assertIn("ensureSidebarPerfState", owner_content)
        self.assertIn("resetProjectedBoundsCacheState", owner_content)
        self.assertIn("ensureSphericalFeatureDiagnosticsCache", owner_content)
        self.assertIn("setInteractionInfrastructureStateFields", owner_content)

    def test_map_renderer_reuses_renderer_runtime_factories(self):
        content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn("./state/renderer_runtime_state.js", content)
        self.assertIn("createDefaultProjectedBoundsCacheState()", content)
        self.assertIn("createDefaultProjectedBoundsDiagnostics()", content)
        self.assertIn("ensureRenderPassCacheState(state,", content)
        self.assertIn("ensureSidebarPerfState(state)", content)
        self.assertIn("resetProjectedBoundsRuntimeCacheState(state);", content)
        self.assertIn("ensureSphericalFeatureDiagnosticsCacheState(state)", content)
        self.assertIn("setInteractionInfrastructureStateFields(state, stage,", content)

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
        self.assertIn("deriveRuntimePrimaryFeaturePayload({", owner_content)
        self.assertIn("createSpatialIndexPerfPayload({", owner_content)
        self.assertIn("export function clearPrimaryIndexMaps(state) {", state_ops_content)
        self.assertIn("export function resetPrimarySpatialState(state) {", state_ops_content)
        self.assertIn("export function resetSecondarySpatialState(state) {", state_ops_content)
        self.assertIn("export function applyPrimarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function applySecondarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function deriveRuntimePrimaryFeaturePayload({", derivation_content)
        self.assertIn("export function createSpatialIndexPerfPayload({", derivation_content)


if __name__ == "__main__":
    unittest.main()