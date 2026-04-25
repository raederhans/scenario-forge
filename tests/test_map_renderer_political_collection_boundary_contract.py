from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
FACADE_DATA_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "facade_data_runtime.js"
POLITICAL_COLLECTION_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "political_collection_owner.js"


class MapRendererPoliticalCollectionBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_transaction_owner_while_political_collection_moves_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        facade_content = FACADE_DATA_RUNTIME_JS.read_text(encoding="utf-8")
        owner_content = POLITICAL_COLLECTION_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createPoliticalCollectionOwner } from './renderer/political_collection_owner.js';",
            renderer_imports,
        )
        self.assertIn("let politicalCollectionOwner = null;", renderer_content)
        self.assertIn("function getPoliticalCollectionOwner() {", renderer_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().getPoliticalFeatureCollection(topology, sourceName);", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().normalizeFeatureGeometry(feature, { sourceLabel });", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().mergeOverrideFeatures(baseFeatures, overrideCollection);", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().composePoliticalFeatures(", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().composePoliticalFeatureCollections(", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().collectCountryCoverageStats(features);", facade_content)
        self.assertIn("return readFacadeGetter('getPoliticalCollectionOwner')().buildInteractiveLandData(fullCollection);", facade_content)
        self.assertIn("function rebuildPoliticalLandCollections() {", renderer_content)
        self.assertIn("runtimeState.landDataFull = fullCollection;", renderer_content)
        self.assertIn("runtimeState.landData = interactiveCollection;", renderer_content)
        self.assertIn("runtimeState.debugCountryCoverage = collectCountryCoverageStats(", renderer_content)

        self.assertIn("export function createPoliticalCollectionOwner({", owner_content)
        self.assertIn("function getPoliticalFeatureCollection(topology, sourceName) {", owner_content)
        self.assertIn("function normalizeFeatureGeometry(feature, { sourceLabel = \"detail\" } = {}) {", owner_content)
        self.assertIn("function mergeOverrideFeatures(baseFeatures, overrideCollection) {", owner_content)
        self.assertIn("function composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection = null) {", owner_content)
        self.assertIn("function composePoliticalFeatureCollections(primaryCollection, detailCollection = null, overrideCollection = null) {", owner_content)
        self.assertIn("function collectCountryCoverageStats(features = []) {", owner_content)
        self.assertIn("function buildInteractiveLandData(fullCollection) {", owner_content)


if __name__ == "__main__":
    unittest.main()
