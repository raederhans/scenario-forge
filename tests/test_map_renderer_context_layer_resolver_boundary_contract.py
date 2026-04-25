from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
FACADE_DATA_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "facade_data_runtime.js"
CONTEXT_LAYER_RESOLVER_JS = REPO_ROOT / "js" / "core" / "renderer" / "context_layer_resolver.js"


class MapRendererContextLayerResolverBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_pass_dispatch_while_context_layer_resolution_moves_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        facade_content = FACADE_DATA_RUNTIME_JS.read_text(encoding="utf-8")
        owner_content = CONTEXT_LAYER_RESOLVER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createContextLayerResolverOwner } from './renderer/context_layer_resolver.js';",
            renderer_imports,
        )
        self.assertIn("let contextLayerResolverOwner = null;", renderer_content)
        self.assertIn("function getContextLayerResolverOwner() {", renderer_content)
        self.assertIn("runtimeState: state,", renderer_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().getLayerFeatureCollection(topology, layerName);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().computeLayerCoverageScore(collection);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().createUrbanLayerCapability(overrides);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().getUrbanFeatureGeoBounds(feature);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().getUrbanLayerCapability(collection);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().canRenderUrbanCollection(capability);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().canPreferUrbanDetailCollection(capability);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().pickBestLayerSource(", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().resolveContextLayerData(layerName);", facade_content)
        self.assertIn("return readFacadeGetter('getContextLayerResolverOwner')().ensureLayerDataFromTopology();", facade_content)
        self.assertIn("function invalidateContextLayerVisualStateBatch(layerNames, reason = \"context-layer-loaded\", { renderNow = true } = {}) {", renderer_content)
        self.assertIn('const targetPasses = new Set(["contextBase"]);', renderer_content)
        self.assertIn('requestRendererRender(`context-layer-visual:${reason}`, { flush: true });', renderer_content)

        self.assertIn("export function createContextLayerResolverOwner({", owner_content)
        self.assertIn("function getLayerFeatureCollection(topology, layerName) {", owner_content)
        self.assertIn("function computeLayerCoverageScore(collection) {", owner_content)
        self.assertIn("function createUrbanLayerCapability(overrides = {}) {", owner_content)
        self.assertIn("function getUrbanFeatureGeoBounds(feature) {", owner_content)
        self.assertIn("function getUrbanLayerCapability(collection) {", owner_content)
        self.assertIn("function canRenderUrbanCollection(capability) {", owner_content)
        self.assertIn("function canPreferUrbanDetailCollection(capability) {", owner_content)
        self.assertIn("function pickBestLayerSource(primaryCollection, detailCollection, policy = {}) {", owner_content)
        self.assertIn("function resolveContextLayerData(layerName) {", owner_content)
        self.assertIn("function ensureLayerDataFromTopology() {", owner_content)


if __name__ == "__main__":
    unittest.main()
