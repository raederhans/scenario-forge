import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_PATH = ROOT / "js/core/map_renderer.js"
SCENARIO_RESOURCES_PATH = ROOT / "js/core/scenario_resources.js"


class ScenarioChunkRefreshContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.map_renderer_source = MAP_RENDERER_PATH.read_text(encoding="utf-8")
        cls.scenario_resources_source = SCENARIO_RESOURCES_PATH.read_text(encoding="utf-8")

    def test_basic_ready_builds_land_spatial_index_before_unlock(self):
        self.assertIn('await buildSpatialIndexChunked({', self.map_renderer_source)
        self.assertIn('includeSecondary: false,', self.map_renderer_source)
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'if \(chunked\) \{\s*await buildIndexChunked\(\{ scheduleUiMode: "deferred" \}\);\s*await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*\}\);\s*\} else \{\s*buildIndex\(\{ scheduleUiMode: "deferred" \}\);\s*buildSpatialIndex\(\{\s*includeSecondary: false,\s*\}\);\s*\}\s*setInteractionInfrastructureState\("basic-ready"',
                re.S,
            ),
        )

    def test_schedule_render_phase_idle_only_short_circuits_for_committed_promotion(self):
        self.assertIn('const committedPendingChunkRefresh = pendingChunkRefreshStatus === "promotion-committed";', self.map_renderer_source)
        self.assertNotIn('const executedPendingChunkRefresh = pendingChunkRefreshStatus === "executed";', self.map_renderer_source)
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'const committedPendingChunkRefresh = pendingChunkRefreshStatus === "promotion-committed";\s*if \(shouldStartExactAfterSettleFastPath\(\)\) \{\s*if \(committedPendingChunkRefresh\) \{\s*return;',
                re.S,
            ),
        )

    def test_chunk_refresh_distinguishes_committed_promotion_from_async_refresh_start(self):
        self.assertIn('return "promotion-committed";', self.scenario_resources_source)
        self.assertIn('return "refresh-started";', self.scenario_resources_source)
        self.assertIn('allowRefreshStart = false,', self.scenario_resources_source)
        self.assertIn('const hasPendingReason = !!allowRefreshStart || !!String(loadState.pendingReason || "").trim();', self.scenario_resources_source)
        self.assertIn('allowRefreshStart: hadPendingReason,', self.scenario_resources_source)

    def test_political_chunk_promotion_refreshes_union_of_previous_and_next_feature_ids(self):
        self.assertIn('const previousFeatureIds = getScenarioFeatureCollectionIdentityList(state.scenarioPoliticalChunkData);', self.scenario_resources_source)
        self.assertIn('const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);', self.scenario_resources_source)
        self.assertRegex(
            self.scenario_resources_source,
            re.compile(
                r'politicalFeatureIds: Array\.from\(new Set\(\[\s*\.\.\.previousFeatureIds,\s*\.\.\.nextFeatureIds,\s*\]\)\)',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
