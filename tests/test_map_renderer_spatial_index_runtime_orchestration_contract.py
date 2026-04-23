from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"


class MapRendererSpatialIndexRuntimeOrchestrationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

    def test_basic_interaction_startup_keeps_chunked_index_then_spatial_order(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'if \(chunked\) \{\s*await buildIndexChunked\(\{ scheduleUiMode: "deferred" \}\);\s*await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*\}\);\s*\} else \{\s*buildIndex\(\{ scheduleUiMode: "deferred" \}\);\s*buildSpatialIndex\(\{\s*includeSecondary: false,\s*\}\);\s*\}',
                re.S,
            ),
        )


    def test_spatial_owner_pass_through_uses_module_level_bindings(self):
        self.assertIn(
            "const resetSecondarySpatialIndexState = (...args) =>\n  getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState(...args);",
            self.renderer_content,
        )
        self.assertIn(
            "const buildSecondarySpatialIndexes = (...args) =>\n  getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes(...args);",
            self.renderer_content,
        )
        self.assertIn(
            "buildIndexChunked,\n  buildSpatialIndex,\n  buildSpatialIndexChunked,\n  configureSpatialRuntimeFacade,\n} from \"./map_renderer/facade_spatial_runtime.js\";",
            self.renderer_content,
        )
        self.assertIn(
            "configureSpatialRuntimeFacade({\n  getSpatialIndexRuntimeOwner,\n});",
            self.renderer_content,
        )

    def test_chunk_promotion_infra_keeps_index_then_spatial_then_secondary_schedule(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'buildIndex\(\);\s*await yieldToMain\(\);\s*if \(promotionVersion !== scenarioChunkPromotionVersion\) \{\s*return false;\s*\}\s*await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*keepReady: true,\s*\}\);\s*if \(promotionVersion !== scenarioChunkPromotionVersion\) \{\s*return false;\s*\}\s*scheduleSecondarySpatialIndexBuild\(\{',
                re.S,
            ),
        )

    def test_chunk_promotion_water_and_special_sync_secondary_indexes_before_deferred_infra(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'function syncScenarioSecondaryRegionIndexes\(\{[\s\S]*?rebuildAuxiliaryRegionIndexes\(\);\s*resetSecondarySpatialIndexState\(\);\s*buildSecondarySpatialIndexes\(\{\s*allowComputeMissingBounds: true,\s*\}\);[\s\S]*?const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes\(\{\s*changedLayerKeys,\s*reason: `\$\{reason\}-secondary-sync`,\s*\}\);',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
