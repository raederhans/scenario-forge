import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_PATH = ROOT / "js/core/map_renderer.js"
SCENARIO_RESOURCES_PATH = ROOT / "js/core/scenario_resources.js"
SCENARIO_CHUNK_RUNTIME_PATH = ROOT / "js/core/scenario/chunk_runtime.js"


class ScenarioChunkRefreshContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.map_renderer_source = MAP_RENDERER_PATH.read_text(encoding="utf-8")
        cls.scenario_resources_source = SCENARIO_RESOURCES_PATH.read_text(encoding="utf-8")
        cls.scenario_chunk_runtime_source = SCENARIO_CHUNK_RUNTIME_PATH.read_text(encoding="utf-8")

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
        self.assertIn('return "promotion-committed";', self.scenario_chunk_runtime_source)
        self.assertIn('return "refresh-started";', self.scenario_chunk_runtime_source)
        self.assertIn('allowRefreshStart = false,', self.scenario_chunk_runtime_source)
        self.assertIn('const hasPendingReason = !!allowRefreshStart || !!String(loadState.pendingReason || "").trim();', self.scenario_chunk_runtime_source)
        self.assertIn('allowRefreshStart: hadPendingReason,', self.scenario_chunk_runtime_source)

    def test_political_chunk_promotion_refreshes_union_of_previous_and_next_feature_ids(self):
        self.assertIn('const previousFeatureIds = getScenarioFeatureCollectionIdentityList(state.scenarioPoliticalChunkData);', self.scenario_chunk_runtime_source)
        self.assertIn('const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);', self.scenario_chunk_runtime_source)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const resolvedPoliticalFeatureIds = Array\.isArray\(politicalFeatureIds\) && politicalFeatureIds\.length\s*\? Array\.from\(new Set\(politicalFeatureIds\)\)\s*: Array\.from\(new Set\(\[\s*\.\.\.previousFeatureIds,\s*\.\.\.nextFeatureIds,\s*\]\)\)',
                re.S,
            ),
        )

    def test_deferred_promotion_flush_records_retry_metric_and_reschedules_commit(self):
        self.assertIn("const hasExplicitPendingDelayMs =", self.scenario_chunk_runtime_source)
        self.assertIn('recordScenarioChunkRuntimeMetric("chunkPromotionDeferredRetryMs", retryDelayMs, {', self.scenario_chunk_runtime_source)
        self.assertIn('schedulePendingScenarioChunkPromotionCommit({', self.scenario_chunk_runtime_source)
        self.assertIn('retry: true,', self.scenario_chunk_runtime_source)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'if \(shouldDeferScenarioChunkRefresh\(\)\) \{[\s\S]*?markPendingScenarioChunkRefresh\(\s*resolvedPendingPromotion\.reason \|\| loadState\.pendingReason \|\| "chunk-promotion-deferred",\s*retryDelayMs,\s*\);\s*recordScenarioChunkRuntimeMetric\("chunkPromotionDeferredRetryMs", retryDelayMs, \{\s*scenarioId,',
                re.S,
            ),
        )

    def test_runtime_chunk_load_state_tracks_promotion_retry_observability_fields(self):
        self.assertIn('promotionRetryCount: 0,', self.scenario_chunk_runtime_source)
        self.assertIn('lastPromotionRetryAt: 0,', self.scenario_chunk_runtime_source)
        self.assertIn('state.runtimeChunkLoadState.promotionRetryCount = Math.max(', self.scenario_chunk_runtime_source)
        self.assertIn('state.runtimeChunkLoadState.lastPromotionRetryAt = Math.max(', self.scenario_chunk_runtime_source)

    def test_execute_chunk_refresh_reschedules_pending_promotion_without_active_timer(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'if \(loadState\.pendingPromotion && !loadState\.promotionScheduled\) \{\s*const delayMs = .*?;\s*schedulePendingScenarioChunkPromotionCommit\(\{ delayMs \}\);\s*if \(loadState\.pendingPromotion && loadState\.promotionScheduled\) \{\s*return "promotion-scheduled";',
                re.S,
            ),
        )

    def test_timer_handle_check_requires_live_timer_shape(self):
        self.assertIn('if (state.runtimeChunkLoadState.promotionTimerId && !isTimerHandle(state.runtimeChunkLoadState.promotionTimerId)) {', self.scenario_chunk_runtime_source)
        self.assertIn('return Number.isFinite(value);', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.ref === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.unref === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.hasRef === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.refresh === "function"', self.scenario_chunk_runtime_source)

    def test_promotion_pipeline_uses_single_commit_entrypoint(self):
        self.assertIn('schedulePendingScenarioChunkPromotionCommit({', self.scenario_chunk_runtime_source)
        self.assertIn('commitPendingScenarioChunkPromotion();', self.scenario_chunk_runtime_source)
        self.assertNotIn("function commitScenarioChunkPromotion(", self.scenario_chunk_runtime_source)
        self.assertNotIn("function storePendingScenarioChunkPromotion(", self.scenario_chunk_runtime_source)


if __name__ == "__main__":
    unittest.main()
