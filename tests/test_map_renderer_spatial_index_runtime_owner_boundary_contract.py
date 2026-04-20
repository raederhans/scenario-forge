from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SPATIAL_INDEX_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_owner.js"


class MapRendererSpatialIndexRuntimeOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_interaction_startup_orchestration_while_spatial_runtime_moves_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = SPATIAL_INDEX_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createSpatialIndexRuntimeOwner } from './renderer/spatial_index_runtime_owner.js';",
            renderer_imports,
        )
        self.assertIn("let spatialIndexRuntimeOwner = null;", renderer_content)
        self.assertIn("function getSpatialIndexRuntimeOwner() {", renderer_content)
        self.assertIn("rebuildAuxiliaryRegionIndexes,", renderer_content)
        self.assertIn("getLogicalCanvasDimensions,", renderer_content)
        self.assertIn("getProjectedFeatureBounds,", renderer_content)
        self.assertIn("buildSpatialGrid,", renderer_content)
        self.assertIn("setInteractionInfrastructureState,", renderer_content)
        self.assertIn("yieldToMain,", renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildIndex({ scheduleUiMode });", renderer_content)
        self.assertIn("const resetSecondarySpatialIndexState = (...args) =>", renderer_content)
        self.assertIn("getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState(...args);", renderer_content)
        self.assertIn("const buildSecondarySpatialIndexes = (...args) =>", renderer_content)
        self.assertIn("getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes(...args);", renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildSpatialIndex({", renderer_content)
        self.assertIn("const buildIndexChunked = (...args) => getSpatialIndexRuntimeOwner().buildIndexChunked(...args);", renderer_content)
        self.assertIn("const buildSpatialIndexChunked = (...args) =>", renderer_content)
        self.assertIn("getSpatialIndexRuntimeOwner().buildSpatialIndexChunked(...args);", renderer_content)
        self.assertIn("function rebuildRuntimeDerivedState({", renderer_content)
        self.assertIn("async function buildBasicInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("async function buildFullInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("function initMap({", renderer_content)
        self.assertIn("function setMapData({", renderer_content)
        self.assertIn("function refreshMapDataForScenarioApply({", renderer_content)

        self.assertIn("export function createSpatialIndexRuntimeOwner({", owner_content)
        self.assertIn("rebuildAuxiliaryRegionIndexes = () => {},", owner_content)
        self.assertIn("function buildIndex({ scheduleUiMode = \"immediate\" } = {}) {", owner_content)
        self.assertIn("function resetSecondarySpatialIndexState() {", owner_content)
        self.assertIn("function buildSecondarySpatialIndexes({", owner_content)
        self.assertIn("getProjectedFeatureBounds(feature, {", owner_content)
        self.assertIn("function buildSpatialIndex({", owner_content)
        self.assertIn("async function buildIndexChunked({", owner_content)
        self.assertIn("async function buildSpatialIndexChunked({", owner_content)
        self.assertNotIn("function rebuildRuntimeDerivedState({", owner_content)


if __name__ == "__main__":
    unittest.main()
