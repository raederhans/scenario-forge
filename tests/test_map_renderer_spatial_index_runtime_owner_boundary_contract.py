from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
FACADE_SPATIAL_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "facade_spatial_runtime.js"
SPATIAL_INDEX_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_owner.js"
SPATIAL_INDEX_RUNTIME_BUILDERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_builders.js"
SPATIAL_INDEX_RUNTIME_STATE_OPS_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_state_ops.js"
SPATIAL_INDEX_RUNTIME_DERIVATION_JS = REPO_ROOT / "js" / "core" / "renderer" / "spatial_index_runtime_derivation.js"


class MapRendererSpatialIndexRuntimeOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_interaction_startup_orchestration_while_spatial_runtime_moves_to_facade_and_owner_helpers(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        facade_content = FACADE_SPATIAL_RUNTIME_JS.read_text(encoding="utf-8")
        owner_content = SPATIAL_INDEX_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        builders_content = SPATIAL_INDEX_RUNTIME_BUILDERS_JS.read_text(encoding="utf-8")
        state_ops_content = SPATIAL_INDEX_RUNTIME_STATE_OPS_JS.read_text(encoding="utf-8")
        derivation_content = SPATIAL_INDEX_RUNTIME_DERIVATION_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createSpatialIndexRuntimeOwner } from './renderer/spatial_index_runtime_owner.js';", renderer_imports)
        self.assertIn("from './map_renderer/facade_spatial_runtime.js';", renderer_imports)
        self.assertIn("let spatialIndexRuntimeOwner = null;", renderer_content)
        self.assertIn("function getSpatialIndexRuntimeOwner() {", renderer_content)
        self.assertIn("rebuildAuxiliaryRegionIndexes,", renderer_content)
        self.assertIn("getLogicalCanvasDimensions,", renderer_content)
        self.assertIn("getProjectedFeatureBounds,", renderer_content)
        self.assertIn("buildSpatialGrid,", renderer_content)
        self.assertIn("setInteractionInfrastructureState,", renderer_content)
        self.assertIn("yieldToMain,", renderer_content)
        self.assertIn("getFeatureBorderMeshCountryCodeNormalized,", renderer_content)
        self.assertIn("const resetSecondarySpatialIndexState = (...args) =>", renderer_content)
        self.assertIn("getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState(...args);", renderer_content)
        self.assertIn("const buildSecondarySpatialIndexes = (...args) =>", renderer_content)
        self.assertIn("getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes(...args);", renderer_content)
        self.assertIn("function rebuildRuntimeDerivedState({", renderer_content)
        self.assertIn("async function buildBasicInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("async function buildFullInteractionInfrastructureAfterStartup({", renderer_content)
        self.assertIn("function initMap({", renderer_content)
        self.assertIn("function setMapData({", renderer_content)
        self.assertIn("function refreshMapDataForScenarioApply({", renderer_content)
        self.assertNotIn("function buildIndex({ scheduleUiMode = \"immediate\" } = {}) {", renderer_content)
        self.assertNotIn("function buildSpatialIndex({", renderer_content)
        self.assertNotIn("const buildIndexChunked = (...args) => getSpatialIndexRuntimeOwner().buildIndexChunked(...args);", renderer_content)

        self.assertIn("export function configureSpatialRuntimeFacade(nextState = {}) {", facade_content)
        self.assertIn("export function buildIndex({ scheduleUiMode = 'immediate' } = {}) {", facade_content)
        self.assertIn("export function buildSpatialIndex({", facade_content)
        self.assertIn("export const buildIndexChunked = (...args) => readSpatialOwner().buildIndexChunked(...args);", facade_content)
        self.assertIn("export const buildSpatialIndexChunked = (...args) =>", facade_content)

        self.assertIn("export function createSpatialIndexRuntimeOwner({", owner_content)
        self.assertIn("appendLandIndexEntriesRange", owner_content)
        self.assertIn("appendLandSpatialItemsRange", owner_content)
        self.assertIn("captureSpatialGridBuild", owner_content)
        self.assertIn("getFeatureBorderMeshCountryCodeNormalized = () => \"\",", owner_content)
        self.assertIn("./spatial_index_runtime_state_ops.js", owner_content)
        self.assertIn("./spatial_index_runtime_derivation.js", owner_content)
        self.assertIn("function buildIndex({ scheduleUiMode = \"immediate\" } = {}) {", owner_content)
        self.assertIn("function rebuildRuntimePrimaryIndex({", owner_content)
        self.assertIn("function resetSecondarySpatialIndexState() {", owner_content)
        self.assertIn("function buildSecondarySpatialIndexes({", owner_content)
        self.assertIn("function buildSpatialIndex({", owner_content)
        self.assertIn("async function buildIndexChunked({", owner_content)
        self.assertIn("async function buildSpatialIndexChunked({", owner_content)
        self.assertIn("clearPrimaryIndexMaps(state);", owner_content)
        self.assertIn("applyPrimarySpatialSnapshot(state, {", owner_content)
        self.assertIn("applySecondarySpatialSnapshot(state, {", owner_content)
        self.assertIn("createSpatialIndexPerfPayload({", owner_content)
        self.assertIn("deriveRuntimePrimaryFeaturePayload({", owner_content)
        self.assertNotIn("function rebuildRuntimeDerivedState({", owner_content)
        self.assertIn("getProjectedFeatureBounds(feature, {", builders_content)
        self.assertIn("borderMeshCountryCode: resolveBorderMeshCountryCode(feature),", builders_content)
        self.assertIn("typeof getFeatureBorderMeshCountryCodeNormalized === \"function\"", builders_content)
        self.assertIn("function captureSpatialGridBuild(", builders_content)

        self.assertIn("export function clearPrimaryIndexMaps(state) {", state_ops_content)
        self.assertIn("export function resetPrimarySpatialState(state) {", state_ops_content)
        self.assertIn("export function resetSecondarySpatialState(state) {", state_ops_content)
        self.assertIn("export function applyPrimarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function applySecondarySpatialSnapshot(state, {", state_ops_content)
        self.assertIn("export function deriveRuntimePrimaryFeaturePayload({", derivation_content)
        self.assertIn("export function createSpatialIndexPerfPayload({", derivation_content)


if __name__ == "__main__":
    unittest.main()
