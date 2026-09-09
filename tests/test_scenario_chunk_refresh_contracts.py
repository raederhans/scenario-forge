import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_PATH = ROOT / "js/core/map_renderer.js"
STATIC_BORDER_MESH_LIFECYCLE_PATH = ROOT / "js/core/renderer/static_border_mesh_lifecycle.js"
DRAW_CANVAS_ORCHESTRATION_OWNER_PATH = ROOT / "js/core/map_renderer/draw_canvas_orchestration_owner.js"
SCENARIO_REFRESH_RUNTIME_PATH = ROOT / "js/core/map_renderer/scenario_refresh_runtime.js"
SCENARIO_REFRESH_PLANS_PATH = ROOT / "js/core/map_renderer/scenario_refresh_plans.js"
SCENARIO_VISUAL_INVALIDATION_EXECUTOR_PATH = ROOT / "js/core/map_renderer/scenario_visual_invalidation_executor.js"
RENDER_INVALIDATION_CATALOG_PATH = ROOT / "js/core/map_renderer/render_invalidation_catalog.js"
EXACT_AFTER_SETTLE_SCHEDULER_PATH = ROOT / "js/core/map_renderer/exact_after_settle_scheduler.js"
RENDER_PHASE_LIFECYCLE_OWNER_PATH = ROOT / "js/core/map_renderer/render_phase_lifecycle_owner.js"
SCENARIO_RESOURCES_PATH = ROOT / "js/core/scenario_resources.js"
SCENARIO_MANAGER_PATH = ROOT / "js/core/scenario_manager.js"
SCENARIO_CHUNK_RUNTIME_PATH = ROOT / "js/core/scenario/chunk_runtime.js"
SCENARIO_BUNDLE_LOADER_PATH = ROOT / "js/core/scenario/bundle_loader.js"
SCENARIO_CHUNK_PROMOTION_HELPERS_PATH = ROOT / "js/core/renderer/scenario_chunk_promotion_helpers.js"
SCENARIO_POST_APPLY_EFFECTS_PATH = ROOT / "js/core/scenario_post_apply_effects.js"
SCENARIO_APPLY_PIPELINE_PATH = ROOT / "js/core/scenario_apply_pipeline.js"
MAIN_JS_PATH = ROOT / "js/main.js"
POST_READY_SCHEDULER_PATH = ROOT / "js/bootstrap/post_ready_scheduler.js"
STARTUP_READY_HANDOFF_PATH = ROOT / "js/bootstrap/startup_ready_handoff.js"
DEFERRED_DETAIL_PROMOTION_PATH = ROOT / "js/bootstrap/deferred_detail_promotion.js"
SCENARIO_RUNTIME_STATE_PATH = ROOT / "js/core/state/scenario_runtime_state.js"
SCENARIO_CHUNK_RUNTIME_ACTIONS_PATH = ROOT / "js/core/state/actions/scenario_chunk_runtime_actions.js"


class ScenarioChunkRefreshContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.map_renderer_source = MAP_RENDERER_PATH.read_text(encoding="utf-8")
        cls.static_border_mesh_lifecycle_source = STATIC_BORDER_MESH_LIFECYCLE_PATH.read_text(encoding="utf-8")
        cls.draw_canvas_orchestration_owner_source = DRAW_CANVAS_ORCHESTRATION_OWNER_PATH.read_text(encoding="utf-8")
        cls.scenario_refresh_runtime_source = SCENARIO_REFRESH_RUNTIME_PATH.read_text(encoding="utf-8")
        cls.scenario_refresh_plans_source = SCENARIO_REFRESH_PLANS_PATH.read_text(encoding="utf-8")
        cls.scenario_visual_invalidation_executor_source = SCENARIO_VISUAL_INVALIDATION_EXECUTOR_PATH.read_text(encoding="utf-8")
        cls.render_invalidation_catalog_source = RENDER_INVALIDATION_CATALOG_PATH.read_text(encoding="utf-8")
        cls.exact_after_settle_scheduler_source = EXACT_AFTER_SETTLE_SCHEDULER_PATH.read_text(encoding="utf-8")
        cls.render_phase_lifecycle_owner_source = RENDER_PHASE_LIFECYCLE_OWNER_PATH.read_text(encoding="utf-8")
        cls.scenario_resources_source = SCENARIO_RESOURCES_PATH.read_text(encoding="utf-8")
        cls.scenario_manager_source = SCENARIO_MANAGER_PATH.read_text(encoding="utf-8")
        cls.scenario_chunk_runtime_source = SCENARIO_CHUNK_RUNTIME_PATH.read_text(encoding="utf-8")
        cls.scenario_bundle_loader_source = SCENARIO_BUNDLE_LOADER_PATH.read_text(encoding="utf-8")
        cls.scenario_chunk_promotion_helpers_source = SCENARIO_CHUNK_PROMOTION_HELPERS_PATH.read_text(encoding="utf-8")
        cls.scenario_post_apply_effects_source = SCENARIO_POST_APPLY_EFFECTS_PATH.read_text(encoding="utf-8")
        cls.scenario_apply_pipeline_source = SCENARIO_APPLY_PIPELINE_PATH.read_text(encoding="utf-8")
        cls.main_source = MAIN_JS_PATH.read_text(encoding="utf-8")
        cls.post_ready_scheduler_source = POST_READY_SCHEDULER_PATH.read_text(encoding="utf-8")
        cls.startup_ready_handoff_source = STARTUP_READY_HANDOFF_PATH.read_text(encoding="utf-8")
        cls.deferred_detail_promotion_source = DEFERRED_DETAIL_PROMOTION_PATH.read_text(encoding="utf-8")
        cls.scenario_runtime_state_source = SCENARIO_RUNTIME_STATE_PATH.read_text(encoding="utf-8")
        cls.scenario_chunk_runtime_actions_source = SCENARIO_CHUNK_RUNTIME_ACTIONS_PATH.read_text(encoding="utf-8")

    def _slice_between(self, source, start_marker, end_marker):
        start = source.find(start_marker)
        self.assertGreaterEqual(start, 0)
        end = source.find(end_marker, start + len(start_marker))
        return source[start:] if end < 0 else source[start:end]

    def test_basic_ready_builds_land_spatial_index_before_unlock(self):
        self.assertIn('await buildSpatialIndexChunked({', self.map_renderer_source)
        self.assertIn('includeSecondary: false,', self.map_renderer_source)
        self.assertRegex(
            self._slice_between(self.map_renderer_source,
                                "async function buildBasicInteractionInfrastructureAfterStartup(",
                                "async function buildFullInteractionInfrastructureAfterStartup("),
            re.compile(
                r'if \(chunked\) \{\s*'
                r'await buildIndexChunked\(\{ scheduleUiMode: "deferred", isCurrent: taskContext\?\.isCurrent, '
                r'yieldControl: \(\) => yieldInteractionInfrastructureBuild\(taskContext\) \}\);\s*'
                r'taskContext\?\.throwIfStale\(\);\s*'
                r'await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*'
                r'isCurrent: taskContext\?\.isCurrent,\s*'
                r'yieldControl: \(\) => yieldInteractionInfrastructureBuild\(taskContext\),\s*\}\);\s*'
                r'\} else \{\s*buildIndex\(\{ scheduleUiMode: "deferred" \}\);\s*'
                r'buildSpatialIndex\(\{\s*includeSecondary: false,\s*\}\);\s*\}\s*'
                r'taskContext\?\.throwIfStale\(\);\s*'
                r'setInteractionInfrastructureState\("basic-ready", \{\s*ready: true,\s*inFlight: false,',
                re.S,
            ),
        )

    def test_schedule_render_phase_idle_short_circuits_for_active_promotion_work(self):
        self.assertIn("const PROMOTION_ACTIVE_STATUSES = Object.freeze([", self.render_phase_lifecycle_owner_source)
        self.assertIn('"promotion-commit-started"', self.render_phase_lifecycle_owner_source)
        self.assertIn('"promotion-commit-in-flight"', self.render_phase_lifecycle_owner_source)
        self.assertNotIn('const executedPendingChunkRefresh = pendingChunkRefreshStatus === "executed";', self.render_phase_lifecycle_owner_source)
        self.assertRegex(
            self.render_phase_lifecycle_owner_source,
            re.compile(
                r'const promotionWorkActive = PROMOTION_ACTIVE_STATUSES\.includes\(String\(pendingChunkRefreshStatus \|\| ""\)\);\s*'
                r'if \(runGetter\(createTrace\(\), "shouldStartExactAfterSettleFastPath"\)\) \{\s*'
                r"if \(promotionWorkActive\) return;[\s\S]*?"
                r'runEffect\(createTrace\(\), "setDeferExactAfterSettle", true\);[\s\S]*?'
                r'runEffect\(createTrace\(\), "scheduleExactAfterSettleRefresh", settleProfile\);',
                re.S,
            ),
        )

    def test_chunk_refresh_distinguishes_committed_promotion_from_async_refresh_start(self):
        self.assertIn('return "promotion-commit-started";', self.scenario_chunk_runtime_source)
        self.assertIn('return "promotion-commit-in-flight";', self.scenario_chunk_runtime_source)
        self.assertIn('return "refresh-started";', self.scenario_chunk_runtime_source)
        self.assertIn('allowRefreshStart = false,', self.scenario_chunk_runtime_source)
        self.assertIn('const hasPendingReason = !!allowRefreshStart || !!String(loadState.pendingReason || "").trim();', self.scenario_chunk_runtime_source)
        self.assertIn('allowRefreshStart: hadPendingReason,', self.scenario_chunk_runtime_source)
        self.assertIn('allowRefreshStart: true,', self.scenario_chunk_runtime_source)
        self.assertIn('if (!hasPendingReason) {', self.scenario_chunk_runtime_source)

    def test_chunk_registry_status_delegates_to_the_runtime_action_owner(self):
        self.assertIn(
            "function createScenarioChunkRegistryEnsurer({\n  patchRuntimeChunkLoadState,",
            self.scenario_bundle_loader_source,
        )
        self.assertRegex(
            self.scenario_bundle_loader_source,
            re.compile(
                r"const expectedLoadStateGeneration = patchRuntimeChunkLoadState\(\s*"
                r'\{ registryStatus: "loading" \},\s*'
                r"\{ returnLoadStateGeneration: true \},\s*"
                r"\);",
                re.S,
            ),
        )
        self.assertRegex(
            self.scenario_bundle_loader_source,
            re.compile(
                r"patchRuntimeChunkLoadState\(\{\s*"
                r'registryStatus: scenarioBundleHasChunkedData\(bundle\) \? "ready" : "empty",\s*'
                r"\}, \{\s*expectedLoadStateGeneration,\s*\}\);",
                re.S,
            ),
        )
        self.assertNotRegex(
            self.scenario_bundle_loader_source,
            re.compile(r"\bchunkState\.registryStatus\s*="),
        )
        self.assertIn(
            'from "./state/actions/scenario_chunk_runtime_actions.js";',
            self.scenario_resources_source,
        )
        self.assertIn(
            "patchRuntimeChunkLoadState: (patch, options) =>",
            self.scenario_resources_source,
        )
        self.assertIn(
            "patchScenarioChunkLoadState(state, patch, options)",
            self.scenario_resources_source,
        )
        self.assertNotIn("state.runtimeChunkLoadState", self.scenario_resources_source)

    def test_political_chunk_promotion_refreshes_union_of_previous_and_next_feature_ids(self):
        self.assertIn('const previousFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalChunkData);', self.scenario_chunk_runtime_source)
        self.assertIn('const nextFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPayload);', self.scenario_chunk_runtime_source)
        self.assertIn('const previousPrimaryFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalVisibleChunkData);', self.scenario_chunk_runtime_source)
        self.assertIn('const nextPrimaryFeatureIds = getScenarioFeatureCollectionIdentityList(normalizedPrimaryPayload);', self.scenario_chunk_runtime_source)
        self.assertIn('commitScenarioPoliticalChunkPayloadState(runtimeState, {', self.scenario_chunk_runtime_source)
        self.assertIn('generationReason: String(reason || "political-chunk-payload"),', self.scenario_chunk_runtime_source)
        self.assertNotIn('runtimeState.scenarioPoliticalChunkData = normalizedPayload', self.scenario_chunk_runtime_source)
        self.assertNotIn('runtimeState.scenarioPoliticalVisibleChunkData = nextPrimaryPoliticalChunkData', self.scenario_chunk_runtime_source)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const resolvedPoliticalFeatureIds = Array\.from\(new Set\(\[\s*'
                r'\.\.\.\(Array\.isArray\(politicalFeatureIds\) \? politicalFeatureIds : \[\]\),\s*'
                r'\.\.\.previousFeatureIds,\s*'
                r'\.\.\.nextFeatureIds,\s*'
                r'\.\.\.previousPrimaryFeatureIds,\s*'
                r'\.\.\.nextPrimaryFeatureIds,\s*'
                r'\]\)\)',
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
                r'if \(shouldDeferScenarioChunkRefreshFor\(\{ allowStartupInitialVisual \}\)\) \{[\s\S]*?markPendingScenarioChunkRefresh\(\s*resolvedPendingPromotion\.reason \|\| loadState\.pendingReason \|\| "chunk-promotion-deferred",\s*retryDelayMs,\s*\{ scenarioApplyRequestId: resolvedPromotionScenarioApplyRequestId \},\s*\);\s*recordScenarioChunkRuntimeMetric\("chunkPromotionDeferredRetryMs", retryDelayMs, \{\s*scenarioId,',
                re.S,
            ),
        )

    def test_runtime_chunk_load_state_tracks_promotion_retry_observability_fields(self):
        self.assertIn('promotionRetryCount: 0,', self.scenario_runtime_state_source)
        self.assertIn('lastPromotionRetryAt: 0,', self.scenario_runtime_state_source)
        self.assertIn('patchScenarioChunkLoadState(runtimeState, {', self.scenario_chunk_runtime_source)
        self.assertIn('promotionRetryCount:', self.scenario_chunk_runtime_source)
        self.assertIn('lastPromotionRetryAt:', self.scenario_chunk_runtime_source)
        self.assertNotIn('runtimeState.runtimeChunkLoadState.promotionRetryCount =', self.scenario_chunk_runtime_source)
        self.assertNotIn('runtimeState.runtimeChunkLoadState.lastPromotionRetryAt =', self.scenario_chunk_runtime_source)


    def test_focus_country_override_has_selection_priority(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const rawFocusCountry = String\(\s*'
                r'loadState\.focusCountryOverride\s*\|\|\s*'
                r'runtimeState\.activeSovereignCode',
                re.S,
            ),
        )
        self.assertIn("function isScenarioChunkFocusCountryInViewport(", self.scenario_chunk_runtime_source)
        self.assertIn('String(chunk?.lod || "").trim().toLowerCase() === "detail"', self.scenario_chunk_runtime_source)
        self.assertIn("focusBoundsIntersect(chunk.bounds, normalizedViewportBbox)", self.scenario_chunk_runtime_source)
        self.assertIn("clearScenarioChunkFocusCountryOverride(loadState);", self.scenario_chunk_runtime_source)
        self.assertIn("resolveScenarioChunkFocusCountry(bundle, loadState, { viewportBbox })", self.scenario_chunk_runtime_source)

    def test_post_ready_scheduler_exposes_pending_task_diagnostics(self):
        self.assertIn("const taskDiagnostics = new Map();", self.post_ready_scheduler_source)
        self.assertIn("function resolveIdleBlockReason(", self.post_ready_scheduler_source)
        self.assertIn('if (targetState.deferExactAfterSettle) return "defer-exact-after-settle";', self.post_ready_scheduler_source)
        self.assertIn('if (!allowChunkBacklog && targetState.runtimeChunkLoadState?.pendingInfraPromotion) return "chunk-infra-promotion";', self.post_ready_scheduler_source)
        self.assertIn('if (targetState.interactionInfrastructureBuildInFlight) return "interaction-infra-in-flight";', self.post_ready_scheduler_source)
        self.assertIn("targetState.renderPerfMetrics.postReadySchedulerState", self.post_ready_scheduler_source)
        self.assertIn("pendingTaskKeys", self.post_ready_scheduler_source)
        self.assertIn("maxRetryCount", self.post_ready_scheduler_source)
        self.assertIn("reasonStateHint", self.post_ready_scheduler_source)
        self.assertIn("allowChunkBacklog = false", self.post_ready_scheduler_source)
        self.assertIn("allowChunkBacklog: true", self.deferred_detail_promotion_source)
        self.assertRegex(
            self.startup_ready_handoff_source,
            re.compile(
                r'function startDeferredFullInteractionInfrastructureBuild\(.*?'
                r'postReadyScheduler\.scheduleTask\("post-ready-full-interaction-infra", \(task\) => \{\s*'
                r'task\.throwIfStale\(\);\s*return buildInteractionInfrastructureAfterStartup\(\{\s*'
                r'taskContext: task,\s*chunked: true,\s*buildHitCanvas: false,\s*mode: "full",.*?'
                r'\}, scopedTaskOptions\(\{\s*'
                r'canStart: \(\) => !targetRuntime\.detailDeferred \|\| !!targetRuntime\.detailPromotionCompleted,',
                re.S,
            ),
        )

    def test_zoom_end_and_visual_stage_metrics_share_selection_context(self):
        self.assertIn("requiredChunkCount", self.scenario_chunk_runtime_source)
        self.assertIn("activePostReadyTaskKey", self.scenario_chunk_runtime_source)
        self.assertIn("promotionRetryCount", self.scenario_chunk_runtime_source)
        self.assertIn("buildScenarioChunkPromotionVisualMetricDetails({", self.scenario_refresh_runtime_source)
        self.assertIn("selectionVersion:", self.scenario_chunk_promotion_helpers_source)
        self.assertIn("requiredPoliticalChunkCount:", self.scenario_chunk_promotion_helpers_source)
        self.assertIn("queueMs:", self.scenario_chunk_promotion_helpers_source)

    def test_interaction_recovery_metrics_cover_chunk_infra_and_continuity_frame(self):
        self.assertIn("CONTINUITY_FRAME_MAX_STALE_AGE_MS", self.map_renderer_source)
        self.assertIn('recordRenderPerfMetric("continuityFrameStaleAgeMs"', self.map_renderer_source)
        self.assertIn('recordRenderPerfMetric("missingVisibleFrameCount"', self.map_renderer_source)
        self.assertIn('return reject("topology-revision-mismatch")', self.map_renderer_source)
        self.assertIn('return reject("stale-age-limit")', self.map_renderer_source)
        self.assertIn('continuityFrameRelaxedReuse', self.map_renderer_source)
        self.assertIn('postReadyInteractionInfrastructureTaskMs', self.map_renderer_source)
        self.assertIn("function recordInteractionRecoveryTaskMetric(", self.map_renderer_source)
        self.assertRegex(
            self.scenario_refresh_runtime_source,
            re.compile(r'const taskKey = "scenario-chunk-promotion-infra";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.scenario_refresh_runtime_source,
            re.compile(
                r'const previousInteractionInfrastructureStage = String\(runtimeState\.interactionInfrastructureStage \|\| ""\);.*?'
                r'await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*keepReady: true,\s*isCurrent,\s*\}\);\s*'
                r'if \(!isCurrent\(\)\) return false;.*?'
                r'setInteractionInfrastructureState\(previousInteractionInfrastructureStage \|\| "basic-ready", \{\s*ready: true,\s*inFlight: false,',
                re.S,
            ),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(r'const taskKey = "secondary-spatial-index";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.static_border_mesh_lifecycle_source,
            re.compile(r'const taskKey = "deferred-heavy-border-meshes";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.exact_after_settle_scheduler_source,
            re.compile(
                r'const generation = Number\(beginExactAfterSettleControllerSchedule\(scheduleStartedAt\) \|\| 0\);.*?'
                r'isExactAfterSettleGenerationCurrent\(generation, "scheduled"\).*?'
                r'if \(!runtimeState\.deferExactAfterSettle\) \{.*?'
                r'resetExactAfterSettleController\("defer-cleared", generation\);.*?'
                r'if \(runtimeState\.renderPhase !== renderPhaseIdle\) \{.*?'
                r'scheduleExactAfterSettleRefresh\(resolvedProfile\);.*?return;',
                re.S,
            ),
        )
        self.assertRegex(
            self.draw_canvas_orchestration_owner_source,
            re.compile(
                r'const activeRenderPassNames = getActiveRenderPassNames\(\);.*?'
                r'drewExactFrame = !!composeCachedPasses\(activeRenderPassNames\);.*?'
                r'finalizePendingExactAfterSettleRefreshAfterPaint\(\);',
                re.S,
            ),
        )
        self.assertIn('recordRenderPerfMetric("settleExactRefreshApply"', self.exact_after_settle_scheduler_source)
        self.assertIn('recordRenderPerfMetric("settleExactRefreshWaitForPaint"', self.exact_after_settle_scheduler_source)
        self.assertIn('recordRenderPerfMetric("settleExactRefreshFinalize"', self.exact_after_settle_scheduler_source)
        interaction_blocker = re.search(
            r"function isInteractionRecoveryBlocked\(\) \{(?P<body>.*?)\n\}",
            self.map_renderer_source,
            re.S,
        )
        self.assertIsNotNone(interaction_blocker)
        self.assertIn("activeInteractionRecoveryTaskKey", interaction_blocker.group("body"))
        self.assertIn("isExactAfterSettleControllerActive()", interaction_blocker.group("body"))
        self.assertNotIn("activePostReadyTaskKey", interaction_blocker.group("body"))

    def test_interaction_recovery_ignores_stale_generation_tasks(self):
        start = self.scenario_refresh_runtime_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(", start)
        infra_source = self.scenario_refresh_runtime_source[start:end]

        self.assertRegex(
            infra_source,
            re.compile(
                r"if \(promotionVersion !== scenarioChunkPromotionVersion\) \{\s*"
                r"return false;\s*"
                r"\}",
                re.S,
            ),
        )
        self.assertRegex(
            infra_source,
            re.compile(
                r"if \(promotionVersion !== scenarioChunkPromotionVersion\) \{\s*"
                r"return false;\s*"
                r"\}[\s\S]*?"
                r"scheduleSecondarySpatialIndexBuild\(",
                re.S,
            ),
        )
        stale_guard_matches = list(re.finditer(
            r"if \(promotionVersion !== scenarioChunkPromotionVersion\) \{\s*return false;\s*\}",
            infra_source,
            re.S,
        ))
        record_index = infra_source.index("recordInteractionRecoveryTaskMetric(taskKey, infraDurationMs")
        self.assertTrue(
            any(match.start() < record_index for match in stale_guard_matches),
            "stale promotion generation must be rejected before recording interaction recovery metrics",
        )
        finally_index = infra_source.index("finally {")
        end_task_index = infra_source.index("endInteractionRecoveryTask(taskKey);", finally_index)
        self.assertGreater(end_task_index, finally_index)

    def test_execute_chunk_refresh_reschedules_pending_promotion_without_active_timer_when_not_flushing(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'if \(loadState\.pendingPromotion && !loadState\.promotionScheduled && !flushPending\) \{\s*const delayMs = .*?;\s*schedulePendingScenarioChunkPromotionCommit\(\{ delayMs \}\);\s*if \(loadState\.pendingPromotion && loadState\.promotionScheduled\) \{\s*return "promotion-scheduled";',
                re.S,
            ),
        )

    def test_flush_pending_ready_path_commits_promotion_immediately(self):
        self.assertIn("setScenarioChunkShellStatus(", self.scenario_chunk_runtime_source)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'if \(loadState\.pendingPromotion && loadState\.promotionScheduled\) \{\s*if \(flushPending\) \{\s*if \(loadState\.promotionTimerId\) \{\s*globalThis\.clearTimeout\(loadState\.promotionTimerId\);',
                re.S,
            ),
        )
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'if \(flushPending\) \{\s*recordRenderTransactionSnapshot\(runtimeState, \{\s*phase: "scenario-chunk-refresh-flush-now",[\s\S]*?\}\);\s*return executeScenarioChunkRefreshNow\(\{\s*bundle,\s*reason: nextReason,\s*flushPending,\s*allowRefreshStart: hadPendingReason,',
                re.S,
            ),
        )
        self.assertIn('setScenarioChunkShellStatus("ready", loadState);', self.scenario_chunk_runtime_source)

    def test_initial_visual_promotion_gate_is_awaitable_without_changing_schedule_return(self):
        self.assertTrue(
            "awaitInitialScenarioChunkVisualPromotion" in self.scenario_chunk_runtime_source,
            "chunk runtime must expose an awaitable initial visual promotion gate",
        )
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r"async function awaitInitialScenarioChunkVisualPromotion\([\s\S]*?\)\s*\{[\s\S]*?"
                r'buildInitialScenarioChunkVisualPromotionResult\("missing-bundle"[\s\S]*?'
                r"await ensureScenarioChunkRegistryLoaded\(bundle, \{ d3Client \}\);[\s\S]*?"
                r"const commitStartupInitialVisualPromotionIfPending = async \(\) => \{[\s\S]*?"
                r"const retryStartupInitialVisualRefreshIfStillUnselected = async \(\) => \{[\s\S]*?"
                r"Math\.max\(0, Number\(loadState\.selectionVersion \|\| 0\)\) > 0[\s\S]*?"
                r"await refreshActiveScenarioChunks\(\{[\s\S]*?"
                r"allowStartupInitialVisual: true,[\s\S]*?"
                r"startupInitialPoliticalOnly: true,[\s\S]*?"
                r"await commitStartupInitialVisualPromotionIfPending\(\);[\s\S]*?"
                r"while \(!result\.ok && getMonotonicNowMs\(\) - readinessStartedAt < STARTUP_INITIAL_VISUAL_READY_TIMEOUT_MS\)",
                re.S,
            ),
        )
        self.assertIn("const STARTUP_INITIAL_VISUAL_READY_TIMEOUT_MS = 8000;", self.scenario_chunk_runtime_source)
        visual_result_body = self.scenario_chunk_runtime_source[
            self.scenario_chunk_runtime_source.index("function buildInitialScenarioChunkVisualPromotionResult("):
            self.scenario_chunk_runtime_source.index("\n  async function awaitInitialScenarioChunkVisualPromotion")
        ]
        self.assertIn("const scenarioPoliticalChunkFeatureCount = getFeatureCount(runtimeState.scenarioPoliticalChunkData);", visual_result_body)
        self.assertIn("const landFeatureCount = getFeatureCount(runtimeState.landData);", visual_result_body)
        self.assertIn("const colorCount = getColorCount();", visual_result_body)
        self.assertIn("selectionVersion > 0", visual_result_body)
        self.assertIn("scenarioPoliticalChunkFeatureCount > 0", visual_result_body)
        self.assertIn("landFeatureCount > 0", visual_result_body)
        self.assertIn("colorCount > 0", visual_result_body)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r"const renderPhaseBlocksRefresh = renderPhase !== \"idle\"[\s\S]*?"
                r"&& !startupInitialVisualAllowed;",
                re.S,
            ),
            "startup initial visual promotion must pass the render-phase gate during boot",
        )
        schedule_source = self.scenario_chunk_runtime_source[
            self.scenario_chunk_runtime_source.index("function scheduleScenarioChunkRefresh("):
            self.scenario_chunk_runtime_source.index("\n  return {", self.scenario_chunk_runtime_source.index("function scheduleScenarioChunkRefresh("))
        ]
        self.assertNotIn("awaitInitialScenarioChunkVisualPromotion(", schedule_source)
        self.assertNotRegex(schedule_source, re.compile(r"return\s+(?:promotionCommitPromise|Promise\.)"))
        self.assertIn('return "scheduled";', schedule_source)
        self.assertIn('return "promotion-commit-started";', self.scenario_chunk_runtime_source)
        self.assertTrue(
            "awaitInitialScenarioChunkVisualPromotion," in self.scenario_chunk_runtime_source,
            "chunk runtime controller return surface must include the awaitable gate",
        )
        self.assertIn(
            "awaitInitialScenarioChunkVisualPromotion,",
            self.scenario_resources_source,
            "scenario_resources must export the awaitable gate",
        )
        self.assertRegex(
            self.scenario_manager_source,
            re.compile(
                r"import \{[\s\S]*?awaitInitialScenarioChunkVisualPromotion,[\s\S]*?\} from \"\.\/scenario_resources\.js\";",
                re.S,
            ),
            "scenario_manager must import the awaitable gate before wiring the apply pipeline",
        )
        self.assertRegex(
            self.scenario_manager_source,
            re.compile(
                r"createScenarioApplyPipeline\(\{[\s\S]*?scheduleScenarioChunkRefresh,\s*"
                r"awaitInitialScenarioChunkVisualPromotion,\s*"
                r"resetScenarioChunkRuntimeState,",
                re.S,
            ),
            "scenario_manager must pass the awaitable gate into scenario_apply_pipeline",
        )
        refresh_source = self.scenario_chunk_runtime_source[
            self.scenario_chunk_runtime_source.index("async function refreshActiveScenarioChunks("):
            self.scenario_chunk_runtime_source.index("async function awaitInitialScenarioChunkVisualPromotion", self.scenario_chunk_runtime_source.index("async function refreshActiveScenarioChunks("))
        ]
        self.assertRegex(
            refresh_source,
            re.compile(
                r"if \(!scenarioBundleUsesChunkedLayer\(bundle\)\) \{[\s\S]*?"
                r"await ensureScenarioChunkRegistryLoaded\(bundle, \{ d3Client \}\);[\s\S]*?"
                r"if \(!scenarioBundleUsesChunkedLayer\(bundle\)\) return null;",
                re.S,
            ),
            "refreshActiveScenarioChunks must hydrate the detail chunk registry before treating a startup bundle as non-chunked",
        )

    def test_ready_state_flushes_pending_scenario_chunk_refresh_before_deferred_full_interaction(self):
        self.assertIn('function scheduleReadyPostBootWork(renderDispatcher, reason = "ready-state")', self.startup_ready_handoff_source)
        self.assertRegex(
            self.startup_ready_handoff_source,
            re.compile(
                r'function scheduleReadyPostBootWork\(renderDispatcher, reason = "ready-state"\) \{[\s\S]*?completeBootSequenceLogging\(\);[\s\S]*?flushPendingScenarioChunkRefreshAfterReady\(reason\);[\s\S]*?scheduleDeferredDetailPromotion\(renderDispatcher\);[\s\S]*?startDeferredFullInteractionInfrastructureBuild\(reason\);',
                re.S,
            ),
        )
        self.assertGreaterEqual(self.main_source.count('scheduleReadyPostBootWork(renderDispatcher, "ready-state");'), 2)
        self.assertRegex(
            self.startup_ready_handoff_source,
            re.compile(
                r'targetRuntime\.scheduleScenarioChunkRefreshFn\(\{\s*reason: normalizedReason,\s*delayMs: 0,\s*flushPending: true,',
                re.S,
            ),
        )
        self.assertIn("const shouldSeedFirstReadyFlush = !!(", self.startup_ready_handoff_source)
        self.assertIn("patchScenarioChunkLoadState(targetRuntime, {", self.startup_ready_handoff_source)
        self.assertIn("pendingReason: normalizedReason,", self.startup_ready_handoff_source)
        self.assertIn("pendingDelayMs: 0,", self.startup_ready_handoff_source)
        self.assertNotIn("loadState.pendingReason =", self.startup_ready_handoff_source)
        self.assertNotIn("loadState.pendingDelayMs =", self.startup_ready_handoff_source)

    def test_startup_initial_visual_gate_runs_before_first_visible_and_deferred_work(self):
        self.assertTrue(
            "awaitInitialScenarioChunkVisualPromotion" in self.main_source,
            "startup must await the initial visual promotion gate before first visible and warmup checkpoints",
        )
        boot_start = self.main_source.index("async function bootstrap() {")
        boot_end = self.main_source.index("await finalizeReadyState(renderDispatcher);", boot_start)
        boot_source = self.main_source[boot_start:boot_end]
        gate_index = boot_source.index("await ensureStartupInitialScenarioChunkVisualReady(")
        first_visible_index = boot_source.index("assertStartupFirstVisibleFrameAccepted(")
        warmup_index = boot_source.index('setBootState("warmup")')
        self.assertLess(gate_index, first_visible_index)
        self.assertLess(gate_index, warmup_index)
        self.assertIn('assertStartupFirstVisibleFrameAccepted("bootstrap-first-political-frame");', boot_source)

        ready_work_start = self.startup_ready_handoff_source.index('function scheduleReadyPostBootWork(renderDispatcher, reason = "ready-state")')
        ready_work_end = self.startup_ready_handoff_source.index("function startDeferredFullInteractionInfrastructureBuild", ready_work_start)
        ready_work_source = self.startup_ready_handoff_source[ready_work_start:ready_work_end]
        self.assertRegex(
            ready_work_source,
            re.compile(
                r"flushPendingScenarioChunkRefreshAfterReady\(reason\);[\s\S]*?"
                r"scheduleDeferredDetailPromotion\(renderDispatcher\);[\s\S]*?"
                r"startDeferredFullInteractionInfrastructureBuild\(reason\);[\s\S]*?"
                r"schedulePostReadyDeferredContextWarmup\(\);[\s\S]*?"
                r"schedulePostReadyVisualWarmup\(\);",
                re.S,
            ),
        )

    def test_detail_promotion_political_reconcile_uses_post_ready_task(self):
        self.assertIn("function reconcileDetailPromotionPoliticalPass(reason = \"detail-promotion-political-reconcile\")", self.map_renderer_source)
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r"function reconcileDetailPromotionPoliticalPass\(reason = \"detail-promotion-political-reconcile\"\) \{[\s\S]*?"
                r"cache\.signatures\.political = \"\";[\s\S]*?"
                r"clearPassFullReferenceTransforms\(\[\"political\"\]\);[\s\S]*?"
                r"invalidateRenderPasses\(\[\"political\"\], normalizedReason\);[\s\S]*?"
                r"requestRendererRender\(normalizedReason, \{[\s\S]*?"
                r"flush: false,[\s\S]*?"
                r"recordRenderPerfMetric\(\"detailPromotionPoliticalReconcile\"",
                re.S,
            ),
        )
        reconcile_source = self.map_renderer_source[
            self.map_renderer_source.index("function reconcileDetailPromotionPoliticalPass("):
            self.map_renderer_source.index("function refreshMapDataForScenarioApply(", self.map_renderer_source.index("function reconcileDetailPromotionPoliticalPass("))
        ]
        self.assertNotIn("fallback:", reconcile_source)
        self.assertNotIn("render();", reconcile_source)
        self.assertNotIn("requestMainRender", reconcile_source)
        self.assertNotIn("requestRender(", reconcile_source)
        self.assertRegex(
            self.startup_ready_handoff_source,
            re.compile(
                r"postReadyScheduler\.scheduleTask\(DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY, async \(task\) => \{\s*"
                r"task\.throwIfStale\(\);\s*"
                r"while \(!targetRuntime\.detailPromotionCompleted\s*"
                r"\|\| !task\.commit\(\(\) => reconcileDetailPromotionPoliticalPass\(normalizedReason\)\)\) \{\s*"
                r"await task\.yield\(\);\s*\}\s*return true;",
                re.S,
            ),
        )
        self.assertNotIn("forcePoliticalFullRepaint", self.map_renderer_source)
        self.assertNotIn("detail-promotion-force", self.map_renderer_source)
        self.assertIn(
            "refreshMapDataForScenarioApply({ suppressRender: true });",
            self.deferred_detail_promotion_source,
        )
        detail_refresh_source = self.deferred_detail_promotion_source[
            self.deferred_detail_promotion_source.index("function applyDetailPromotionMapRefresh({"):
            self.deferred_detail_promotion_source.index("/**", self.deferred_detail_promotion_source.index("function applyDetailPromotionMapRefresh({"))
        ]
        active_scenario_refresh_source = detail_refresh_source[
            detail_refresh_source.index("if (hasActiveScenario) {"):
            detail_refresh_source.index("setMapData({", detail_refresh_source.index("if (hasActiveScenario) {"))
        ]
        self.assertIn(
            "refreshMapDataForScenarioApply({ suppressRender: true });",
            active_scenario_refresh_source,
        )
        self.assertNotIn("setMapData(", active_scenario_refresh_source)
        self.assertNotIn("setMapData-fallback", detail_refresh_source)
        self.assertNotIn("falling back to setMapData", detail_refresh_source)
        self.assertNotIn("catch (error)", detail_refresh_source)
        self.assertIn(
            'postReadyScheduler.scheduleTask(DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY, async (task) => {',
            self.startup_ready_handoff_source,
        )
        self.assertNotIn("schedulePostReadyPoliticalReconcileTask(normalizedReason);", self.startup_ready_handoff_source)

    def test_detail_topology_prepare_without_map_refresh_defers_political_reconcile(self):
        self.assertRegex(
            self.deferred_detail_promotion_source,
            re.compile(
                r"let mapDataRefreshed = false;[\s\S]*?"
                r"if \(applyMapData\) \{[\s\S]*?"
                r"applyDetailPromotionMapRefresh\([\s\S]*?"
                r"mapDataRefreshed = true;[\s\S]*?"
                r"runtimeState\.detailPromotionCompleted = true;[\s\S]*?"
                r"if \(mapDataRefreshed\) \{[\s\S]*?"
                r"schedulePostReadyPoliticalReconcile\?\.\(\"detail-topology-ready\"\);",
                re.S,
            ),
        )
        self.assertRegex(
            self.deferred_detail_promotion_source,
            re.compile(
                r"const refreshMode = applyDetailPromotionMapRefresh\([\s\S]*?"
                r"mapDataRefreshed = true;[\s\S]*?"
                r"if \(mapDataRefreshed\) \{\s*"
                r"schedulePostReadyPoliticalReconcile\?\.\(\"detail-topology-promoted\"\);",
                re.S,
            ),
        )
        self.assertRegex(
            self.scenario_apply_pipeline_source,
            re.compile(
                r"async function stageScenarioReadinessPatch\([\s\S]*?"
                r"if \(startupReadonly \|\| supportsChunkedPoliticalRuntime\) \{[\s\S]*?"
                r"detailPromoted: false,[\s\S]*?"
                r"await prepareScenarioDetailTopologyState\(\);",
                re.S,
            ),
        )
        readonly_unlock_source = self.deferred_detail_promotion_source[
            self.deferred_detail_promotion_source.index("async function unlockStartupReadonlyWithDetail("):
            self.deferred_detail_promotion_source.index("function scheduleDeferredDetailPromotion(", self.deferred_detail_promotion_source.index("async function unlockStartupReadonlyWithDetail("))
        ]
        self.assertNotIn("schedulePostReadyPoliticalReconcile", readonly_unlock_source)
        self.assertNotIn('schedulePostReadyPoliticalReconcile?.("startup-readonly-unlocked")', readonly_unlock_source)
        self.assertNotIn('schedulePostReadyPoliticalReconcile?.("startup-readonly-force-unlocked")', readonly_unlock_source)

    def test_pending_promotion_keeps_same_selection_version_across_visual_infra_and_commit_payload(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const pendingVisualPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?const pendingInfraPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?const pendingPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?queueScenarioChunkPromotionState\(runtimeState, \{\s*visualPromotion: pendingVisualPromotion,\s*infraPromotion: pendingInfraPromotion,\s*promotion: pendingPromotion,',
                re.S,
            ),
        )

    def test_last_selection_records_post_refresh_selection_version_with_generation_fence(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const currentSelectionVersion = Math\.max\(0, Number\(loadState\.selectionVersion \|\| 0\)\);\s*'
                r'const nextSelectionVersion = selectionUnchanged \? currentSelectionVersion : currentSelectionVersion \+ 1;[\s\S]*?'
                r'const lastSelection = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?\};[\s\S]*?'
                r'const committedSelectionVersion = commitScenarioChunkSelectionState\(\s*runtimeState,\s*'
                r'\{\s*selectionVersion: nextSelectionVersion,[\s\S]*?lastSelection,\s*\},\s*'
                r'\{ expectedLoadStateGeneration: refreshLoadStateGeneration \},\s*\);\s*'
                r'if \(committedSelectionVersion === false\) \{[\s\S]*?return null;\s*\}',
                re.S,
            ),
        )

    def test_timer_handle_check_requires_live_timer_shape(self):
        self.assertIn('ensureScenarioChunkRuntimeState(runtimeState);', self.scenario_chunk_runtime_source)
        self.assertIn('function isRuntimeTimerHandle(value) {', self.scenario_chunk_runtime_actions_source)
        self.assertIn('typeof value.ref === "function"', self.scenario_chunk_runtime_actions_source)
        self.assertIn('typeof value.unref === "function"', self.scenario_chunk_runtime_actions_source)
        self.assertIn('typeof value.hasRef === "function"', self.scenario_chunk_runtime_actions_source)
        self.assertIn('typeof value.refresh === "function"', self.scenario_chunk_runtime_actions_source)

    def test_promotion_pipeline_uses_single_commit_entrypoint(self):
        self.assertIn('schedulePendingScenarioChunkPromotionCommit({', self.scenario_chunk_runtime_source)
        self.assertIn('let promotionCommitPromise = null;', self.scenario_chunk_runtime_source)
        self.assertIn('let promotionCommitRunId = 0;', self.scenario_chunk_runtime_source)
        commit_call_sites = re.findall(
            r'(?m)^(?!\s*//)(?!.*\bfunction\s+commitPendingScenarioChunkPromotion\b).*?'
            r'\bcommitPendingScenarioChunkPromotion\s*\(',
            self.scenario_chunk_runtime_source,
        )
        boundary_call_sites = re.findall(r'\b(?:void|await)\s+commitPendingScenarioChunkPromotionWithErrorBoundary\s*\(', self.scenario_chunk_runtime_source)
        self.assertEqual(len(commit_call_sites), 1)
        self.assertEqual(len(boundary_call_sites), 3)
        error_boundary = self._slice_between(
            self.scenario_chunk_runtime_source,
            "async function commitPendingScenarioChunkPromotionWithErrorBoundary(",
            "function captureMergedLayerRuntimeSnapshot(",
        )
        self.assertIn("runtimeState.runtimeChunkLoadState === loadState", error_boundary)
        self.assertIn("let boundaryRunId = promotionCommitRunId;", error_boundary)
        self.assertIn("promotionCommitRunId === boundaryRunId", error_boundary)
        self.assertIn(
            "Math.max(0, Number(loadState.promotionCommitRunId || 0)) === boundaryRunId",
            error_boundary,
        )
        self.assertIn('setPromotionCommitStatus("error"', error_boundary)
        self.assertIn('console.warn(', error_boundary)
        self.assertIn('return "promotion-commit-started";', self.scenario_chunk_runtime_source)
        self.assertIn('return "promotion-commit-in-flight";', self.scenario_chunk_runtime_source)
        self.assertIn('await yieldToFrame();', self.scenario_chunk_runtime_source)
        self.assertNotIn("function commitScenarioChunkPromotion(", self.scenario_chunk_runtime_source)
        self.assertNotIn("function storePendingScenarioChunkPromotion(", self.scenario_chunk_runtime_source)

    def test_promotion_commit_replays_pending_refresh_after_single_flight(self):
        self.assertIn("pendingPostCommitRefresh", self.scenario_chunk_runtime_source)
        self.assertIn("scheduleScenarioChunkRefresh({", self.scenario_chunk_runtime_source)
        self.assertIn("pendingPostCommitRefresh.selectionVersion", self.scenario_chunk_runtime_source)
        self.assertIn("pendingPostCommitRefresh.scenarioId", self.scenario_chunk_runtime_source)
        self.assertIn("const staleReplay =", self.scenario_chunk_runtime_source)
        self.assertIn('const replayReason = pendingPostCommitRefresh.reason || "post-commit-refresh";', self.scenario_chunk_runtime_source)
        self.assertIn('reason: replayReason,', self.scenario_chunk_runtime_source)
        self.assertNotIn('clearPendingScenarioChunkRefresh(loadState);\n        return "promotion-commit-in-flight";', self.scenario_chunk_runtime_source)

    def test_zoom_end_priority_can_advance_during_settling(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'function shouldDeferScenarioChunkRefreshFor\(\{[\s\S]*?'
                r'allowZoomEndSettling = false,[\s\S]*?'
                r'allowStartupInitialVisual = false,[\s\S]*?'
                r'const renderPhase = String\(runtimeState\.renderPhase \|\| "idle"\);[\s\S]*?'
                r'const startupInitialVisualAllowed = !!\([\s\S]*?allowStartupInitialVisual[\s\S]*?'
                r'const renderPhaseBlocksRefresh = renderPhase !== "idle"[\s\S]*?'
                r'&& !\(allowZoomEndSettling && renderPhase === "settling"\)[\s\S]*?'
                r'&& !startupInitialVisualAllowed;[\s\S]*?'
                r'const bootBlockingRefresh = !!runtimeState\.bootBlocking && !startupInitialVisualAllowed;[\s\S]*?'
                r'const startupInteractionRefreshBlocked = !!\([\s\S]*?runtimeState\.startupReadonly[\s\S]*?!startupInitialVisualAllowed[\s\S]*?'
                r'\|\| renderPhaseBlocksRefresh',
                re.S,
            ),
        )
        self.assertIn("const allowZoomEndSettling = shouldZoomEndPromoteImmediately(bundle, reason);", self.scenario_chunk_runtime_source)
        self.assertIn("shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling, allowStartupInitialVisual })", self.scenario_chunk_runtime_source)
        self.assertIn("shouldDeferScenarioChunkRefreshFor({ allowZoomEndSettling: zoomEndPriorityEnabled })", self.scenario_chunk_runtime_source)

    def test_zoom_end_detail_chunks_are_protected_through_exact_settle_replay(self):
        self.assertIn("function protectZoomEndChunks(loadState, chunkIds = [], {", self.scenario_chunk_runtime_source)
        self.assertIn("function clearZoomEndChunkProtection(loadState)", self.scenario_chunk_runtime_source)
        self.assertIn("function isZoomEndChunkProtectionContextValid(protectionState = {}, {", self.scenario_chunk_runtime_source)
        self.assertIn("function protectZoomEndChunksForSelection(target, chunkIds = [], {", self.scenario_chunk_runtime_source)
        self.assertIn("function applyZoomEndChunkProtectionToSelection(selection, target, {", self.scenario_chunk_runtime_source)
        self.assertIn("function applyZoomEndChunkProtection(selection, loadState, {", self.scenario_chunk_runtime_source)
        self.assertIn("selectionVersion: pendingPromotion.selectionVersion || loadState.selectionVersion || 0", self.scenario_chunk_runtime_source)
        self.assertIn("selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0))", self.scenario_chunk_runtime_source)
        self.assertIn("clearZoomEndChunkProtectionState(target);", self.scenario_chunk_runtime_source)
        self.assertIn("zoomEndProtectedChunkIds", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedUntil", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedSelectionVersion", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedFocusCountry", self.scenario_runtime_state_source)
        self.assertIn("cacheOnlyChunkIds", self.scenario_chunk_runtime_source)
        self.assertIn("nextCacheOnlyChunkIds", self.scenario_chunk_runtime_source)
        self.assertIn("previousSelection?.cacheOnlyChunkIds", self.scenario_chunk_runtime_source)
        self.assertIn("loadState.lastSelection?.cacheOnlyChunkIds", self.scenario_chunk_runtime_source)

    def test_zoom_end_evictable_protection_contracts_cover_ttl_focus_country_and_selection_version(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'function isZoomEndChunkProtectionContextValid\(protectionState = \{\}, \{[\s\S]*?'
                r'ttlMs = 5000,[\s\S]*?'
                r'Number\(nowMs \|\| 0\) <= expiresAt[\s\S]*?'
                r'protectedSelectionVersion === requestedSelectionVersion[\s\S]*?'
                r'protectedScenarioId === requestedScenarioId[\s\S]*?'
                r'protectedFocusCountry === requestedFocusCountry',
                re.S,
            ),
        )
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'applyZoomEndChunkProtectionToSelection\(selection, target, \{[\s\S]*?'
                r'reason = "",[\s\S]*?previousSelection = null,[\s\S]*?'
                r'isZoomEndChunkProtectionContextValid\(\{[\s\S]*?zoomEndProtectedSelectionVersion[\s\S]*?zoomEndProtectedFocusCountry[\s\S]*?\}, \{[\s\S]*?\}\)[\s\S]*?'
                r'isZoomEndChunkProtectionContextValid\(\{[\s\S]*?previousSelection\?\.selectionVersion[\s\S]*?previousSelection\?\.focusCountry[\s\S]*?\}, \{[\s\S]*?\}\)',
                re.S,
            ),
        )

    def test_promotion_commit_can_be_cancelled_by_runtime_hook(self):
        self.assertIn('import { registerRuntimeHook } from "../state/index.js";', self.scenario_chunk_runtime_source)
        self.assertIn('function cancelScenarioChunkPromotionCommit(reason = "cancel")', self.scenario_chunk_runtime_source)
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'registerRuntimeHook\(\s*runtimeState,\s*'
                r'"cancelScenarioChunkPromotionCommitFn",\s*'
                r'\(reason\) => cancelScenarioChunkPromotionCommit\(reason\),\s*'
                r'\);',
                re.S,
            ),
        )
        self.assertIn(
            "if (runtimeState.runtimeChunkLoadState !== loadState) return false;",
            self.scenario_chunk_runtime_source,
        )
    def test_chunk_promotion_visual_apply_yields_under_render_lock_and_revalidates(self):
        self.assertIn('function setPromotionCommitStatus(status, details = {})', self.scenario_chunk_runtime_source)
        visual_start = self.scenario_chunk_runtime_source.index('setPromotionCommitStatus("applying-visual"')
        visual_end = self.scenario_chunk_runtime_source.index('recordScenarioChunkRuntimeMetric("chunkPromotionCommitVisualMs"', visual_start)
        visual_slice = self.scenario_chunk_runtime_source[visual_start:visual_end]

        self.assertIn("applyScenarioPoliticalChunkPayload(", visual_slice)
        self.assertIn("await yieldToFrame();", visual_slice)
        self.assertIn("isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })", visual_slice)
        self.assertIn("canRollbackPromotionContinuation()", visual_slice)
        self.assertIn("restoreMergedLayerRuntimeSnapshot(mergedLayerSnapshot);", visual_slice)
        self.assertIn(
            "restoreScenarioChunkPromotionRootState(runtimeState, promotionRootSnapshot);",
            visual_slice,
        )
        self.assertIn('reason: "scenario-chunk-promotion-stale-rollback"', visual_slice)
        self.assertRegex(
            visual_slice,
            re.compile(
                r'await yieldToFrame\(\);.*?'
                r'if \(!isPendingScenarioChunkPromotionCurrent.*?'
                r'flushRenderBoundary\("scenario-chunk-promotion"\);.*?'
                r'setScenarioChunkPromotionRenderLockState\(runtimeState, previousRenderLock\);',
                re.S,
            ),
        )

    def test_stale_promotion_rollback_is_current_owner_scoped_and_city_sync_aware(self):
        rollback_start = self.scenario_chunk_runtime_source.index(
            "const canRollbackPromotionContinuation = () => {"
        )
        rollback_end = self.scenario_chunk_runtime_source.index(
            "const restoreScenarioDataGenerationSnapshot = () => {",
            rollback_start,
        )
        rollback_slice = self.scenario_chunk_runtime_source[rollback_start:rollback_end]
        for required_token in (
            "runtimeState.runtimeChunkLoadState !== loadState",
            "promotionCommitRunId !== runId",
            "loadState.promotionCommitRunId",
            "loadState.pendingPromotion !== pendingPromotion",
            "captureScenarioChunkLoadStateContinuation(runtimeState)",
            "currentContinuationState.activeScenarioId !== scenarioId",
            "promotionContinuationState.activeScenarioId !== scenarioId",
            "Number.isSafeInteger(loadStateGeneration)",
            "loadStateGeneration !== continuationLoadStateGeneration",
            "promotionScenarioApplyRequestId === continuationRequestId",
        ):
            self.assertIn(required_token, rollback_slice)
        self.assertNotIn("isScenarioApplyRequestCurrentForScenario", rollback_slice)
        self.assertNotIn("canRollbackPendingScenarioChunkPromotion", self.scenario_chunk_runtime_source)
        self.assertEqual(
            self.scenario_chunk_runtime_source.count(
                "canRollbackPromotionContinuation()"
            ),
            3,
        )
        ownership_start = self.scenario_chunk_runtime_source.index(
            "function resolvePendingScenarioChunkPromotionOwnedScenarioId("
        )
        ownership_end = self.scenario_chunk_runtime_source.index(
            "async function applyPendingScenarioChunkPromotion",
            ownership_start,
        )
        ownership_slice = self.scenario_chunk_runtime_source[ownership_start:ownership_end]
        self.assertIn("runtimeState.runtimeChunkLoadState !== loadState", ownership_slice)
        self.assertIn("promotionCommitRunId !== runId", ownership_slice)
        self.assertIn("loadState.promotionCommitRunId", ownership_slice)
        self.assertIn(
            "normalizedScenarioId !== normalizeScenarioId(runtimeState.activeScenarioId)",
            ownership_slice,
        )
        restore_start = self.scenario_chunk_runtime_source.index("function restoreMergedLayerRuntimeSnapshot")
        restore_end = self.scenario_chunk_runtime_source.index("function isPendingScenarioChunkPromotionCurrent", restore_start)
        restore_slice = self.scenario_chunk_runtime_source[restore_start:restore_end]
        self.assertIn("restoreScenarioChunkPromotionState(runtimeState, [entry])", restore_slice)
        self.assertIn("if (!Array.isArray(restoreResult?.externalEffects))", restore_slice)
        self.assertNotIn('entry?.layerKey === "cities"', restore_slice)
        self.assertIn('externalEffect?.type === "scenario-city-overrides"', restore_slice)
        self.assertIn("syncScenarioLocalizationState({ cityOverridesPayload: externalEffect.payload });", restore_slice)
        token_validation = 'externalEffect.finalizerToken?.type !== "scenario-city-restore-finalizer"'
        self.assertIn(token_validation, restore_slice)
        self.assertLess(
            restore_slice.index(token_validation),
            restore_slice.index("syncScenarioLocalizationState({ cityOverridesPayload: externalEffect.payload });"),
        )
        self.assertIn("finalizeScenarioChunkCityExternalEffectState(", restore_slice)

    def test_chunk_runtime_commits_complete_render_metrics_through_diagnostics_action(self):
        self.assertIn(
            'import { setRenderPerfMetricEntryState } from "../state/actions/renderer_diagnostics_actions.js";',
            self.scenario_chunk_runtime_source,
        )
        metric_writer = self._slice_between(
            self.scenario_chunk_runtime_source,
            "  function recordScenarioRenderMetric(",
            "\n  function shouldRecordScenarioChunkRuntimeMetric(",
        )
        self.assertIn("setRenderPerfMetricEntryState(runtimeState, {", metric_writer)
        self.assertIn("name,", metric_writer)
        self.assertIn("entry: {", metric_writer)
        self.assertIn("globalThis.__renderPerfMetrics = runtimeState.renderPerfMetrics;", metric_writer)
        self.assertNotRegex(metric_writer, r"(?m)^\s*runtimeState\.renderPerfMetrics\s*=")
        self.assertNotRegex(metric_writer, r"runtimeState\.renderPerfMetrics\[[^\]]+\]\s*=")

    def test_chunk_promotion_infra_does_not_rebuild_static_meshes(self):
        start = self.scenario_refresh_runtime_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(", start)
        promotion_infra_source = self.scenario_refresh_runtime_source[start:end]
        self.assertIn("primaryVisibleDerivedStateReady = false,", promotion_infra_source)
        self.assertIn("completePoliticalDerivedStateReady = false,", promotion_infra_source)
        self.assertIn("primaryDerivedStateReady = false,", promotion_infra_source)
        self.assertIn('if (hasPoliticalGeometryChange) {', promotion_infra_source)
        self.assertIn('ensureSovereigntyState();', promotion_infra_source)
        self.assertIn('if (refreshOpeningOwnerBorders !== false) {', promotion_infra_source)
        self.assertIn('refreshScenarioOpeningOwnerBorders({', promotion_infra_source)
        self.assertIn('invalidateBorderCache();', promotion_infra_source)
        self.assertNotIn('rebuildStaticMeshes();', promotion_infra_source)

    def test_political_chunk_promotion_rebuilds_primary_runtime_state_before_visual_render(self):
        helper_start = self.map_renderer_source.index("function clearDeferredInternalBorderMeshCaches(")
        helper_end = self.map_renderer_source.index("function buildDetailAdmMeshSignature", helper_start)
        helper_source = self.map_renderer_source[helper_start:helper_end]
        self.assertIn("setStaticMeshSourceCountries(getSourceCountrySets());", helper_source)
        self.assertIn("runtimeState.cachedProvinceBorders = [];", helper_source)
        self.assertIn("runtimeState.cachedProvinceBordersByCountry = new Map();", helper_source)
        self.assertIn("runtimeState.cachedLocalBorders = [];", helper_source)
        self.assertIn("runtimeState.cachedLocalBordersByCountry = new Map();", helper_source)
        self.assertIn("getBorderMeshOwner().replaceDetailAdmBorders();", helper_source)
        border_owner = (ROOT / "js/core/renderer/border_mesh_owner.js").read_text(encoding="utf-8")
        self.assertIn("function replaceDetailAdmBorders(meshes = [])", border_owner)
        self.assertIn("replaceCachedDetailAdmBordersState(state, meshes);", border_owner)
        self.assertIn("runtimeState.cachedGridLines = [];", helper_source)
        self.assertIn("resetVisibleInternalBorderMeshSignature();", helper_source)
        self.assertIn("resetDetailAdmMeshBuildState();", helper_source)
        self.assertIn("syncStaticMeshSnapshot();", helper_source)

        promotion_start = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(")
        promotion_end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioApply(", promotion_start)
        promotion_source = self.scenario_refresh_runtime_source[promotion_start:promotion_end]
        self.assertRegex(
            promotion_source,
            re.compile(
                r'if \(hasPoliticalChange\) \{[\s\S]*?'
                r'rebuildPrimaryPoliticalDerivedState\(\{\s*scheduleUiMode: "deferred",\s*buildSpatial: true,\s*includeSecondarySpatial: false,\s*\}\);\s*\}'
                r'[\s\S]*?if \(hasPoliticalChange\) \{\s*clearDeferredInternalBorderMeshCaches\(\);\s*scheduleDeferredHeavyBorderMeshes\(\);\s*\}',
                re.S,
            ),
        )

    def test_chunk_promotion_visual_invalidation_uses_executor_and_frame_graph_bridge(self):
        promotion_start = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(")
        promotion_end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioApply(", promotion_start)
        promotion_source = self.scenario_refresh_runtime_source[promotion_start:promotion_end]

        self.assertIn("function resolveFrameGraphInvalidationExecutionPlan(", self.scenario_refresh_plans_source)
        self.assertIn("const executionPlan = resolveFrameGraphInvalidationExecutionPlan(", self.scenario_refresh_plans_source)
        self.assertIn("invalidationTargetPasses", self.scenario_refresh_plans_source)
        frame_graph_start = self.scenario_refresh_plans_source.index("function createFrameGraphInvalidation(")
        frame_graph_end = self.scenario_refresh_plans_source.index(
            "function getFrameGraphInvalidationTargetPasses(",
            frame_graph_start,
        )
        frame_graph_source = self.scenario_refresh_plans_source[frame_graph_start:frame_graph_end]
        frame_graph_execution_plan_source = self._slice_between(
            self.scenario_refresh_plans_source,
            "function resolveFrameGraphInvalidationExecutionPlan(",
            "function createScenarioApplyRefreshPlan(",
        )
        export_source = self.scenario_refresh_plans_source[self.scenario_refresh_plans_source.index("export {"):]
        self.assertNotIn("legacyTargetPasses", frame_graph_source)
        self.assertNotIn("targetPasses", frame_graph_source)
        self.assertNotRegex(frame_graph_source, r"\btargetPasses:")
        self.assertNotIn("getTargetResourcesForPasses(targetPasses)", frame_graph_source)
        self.assertNotIn("getFrameGraphInvalidationTargetPasses,", export_source)
        self.assertIn("createScenarioVisualInvalidationExecutor({", self.scenario_refresh_runtime_source)
        self.assertIn("scenarioVisualInvalidationExecutor.executeScenarioVisualInvalidation({", promotion_source)
        self.assertRegex(
            promotion_source,
            re.compile(
                r"executionPlan:\s*\{[\s\S]*?"
                r"targetResources[\s\S]*?"
                r"invalidationTargetPasses[\s\S]*?"
                r"hasExplicitTargetResources[\s\S]*?"
                r"\}",
                re.S,
            ),
        )
        self.assertNotRegex(promotion_source, r"executionPlan:\s*\{[\s\S]*?\btargetPasses\s*[,}:]")
        self.assertNotRegex(frame_graph_execution_plan_source, r"\btargetPasses\s*[,}:]")
        self.assertNotIn("const invalidationTargetPasses = targetPasses.length", promotion_source)
        self.assertNotIn("legacyTargetPasses:", promotion_source)
        self.assertNotIn("legacyTargetPassCount", promotion_source)
        self.assertIn("targetPassCount", promotion_source)
        self.assertIn(
            "function createScenarioVisualInvalidationExecutor(deps = {})",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertIn(
            "export const UNSUPPORTED_RENDER_PASS_INPUT_KEYS = Object.freeze([",
            self.render_invalidation_catalog_source,
        )
        self.assertIn(
            "UNSUPPORTED_RENDER_PASS_INPUT_KEYS",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertIn(
            'from "./render_invalidation_catalog.js";',
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertNotIn(
            "const RETIRED_VISUAL_INVALIDATION_PASS_INPUT_KEYS = Object.freeze([",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertIn(
            "function findRetiredVisualInvalidationPassInputKey(inputs = {})",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertIn(
            "findRetiredVisualInvalidationPassInputKey(executionPlan)",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertIn(
            "assertExecutionPlanHasNoRetiredPassFields(executionPlan, retiredInputs);",
            self.scenario_visual_invalidation_executor_source,
        )
        self.assertNotRegex(
            self.scenario_visual_invalidation_executor_source,
            r"function executeScenarioVisualInvalidation\([\s\S]*?\btargetPasses\s*=",
        )
        self.assertNotIn("const legacyTargetPasses =", self.scenario_visual_invalidation_executor_source)
        self.assertNotIn("scenario_refresh_runtime.js", self.scenario_visual_invalidation_executor_source)
        self.assertNotIn("exact_after_settle_scheduler.js", self.scenario_visual_invalidation_executor_source)
        self.assertNotIn("map_renderer.js", self.scenario_visual_invalidation_executor_source)

    def test_scenario_apply_refresh_still_rebuilds_static_meshes(self):
        self.assertRegex(
            self.scenario_refresh_runtime_source,
            re.compile(
                r'function refreshMapDataForScenarioApply\(\{[\s\S]*?markAllOverlaysDirty\(\);\s*rebuildStaticMeshes\(\{\s*refreshOpeningOwnerBorders: rendererRefreshPlan\.refreshOpeningOwnerBorders,\s*\}\);\s*invalidateBorderCache\(\);[\s\S]*?scheduleSecondarySpatialIndexBuild\(\{',
                re.S,
            ),
        )

    def test_scenario_apply_uses_single_explicit_opening_border_refresh_after_shell_overlay(self):
        apply_start = self.scenario_post_apply_effects_source.index("async function runPostScenarioApplyEffects(")
        apply_end = self.scenario_post_apply_effects_source.index("function runPostScenarioResetEffects(", apply_start)
        apply_source = self.scenario_post_apply_effects_source[apply_start:apply_end]
        self.assertIn("createScenarioApplyRefreshPlan({", apply_source)
        self.assertIn("refreshOpeningOwnerBorders: false,", apply_source)
        self.assertIn("refreshPlan,", apply_source)
        self.assertIn("refreshScenarioShellOverlays({", apply_source)
        self.assertIn("refreshOpeningOwnerBorders: false,", apply_source)
        self.assertEqual(apply_source.count("refreshScenarioOpeningOwnerBorders({"), 1)
        self.assertNotIn("openingOwnerBordersRefreshedByMapRefresh", apply_source)

    def test_chunk_promotion_opening_owner_refresh_has_single_owner(self):
        start = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(")
        end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioApply(", start)
        promotion_source = self.scenario_refresh_runtime_source[start:end]
        self.assertIn("const shouldRefreshOpeningOwnerBordersInVisual =", promotion_source)
        self.assertIn("refreshOpeningOwnerBorders: !shouldRefreshOpeningOwnerBordersInVisual,", promotion_source)
        self.assertIn("if (shouldRefreshOpeningOwnerBordersInVisual) {", promotion_source)
        infra_start = self.scenario_refresh_runtime_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        infra_end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(", infra_start)
        infra_source = self.scenario_refresh_runtime_source[infra_start:infra_end]
        self.assertIn("refreshOpeningOwnerBorders = true,", infra_source)
        self.assertIn("refreshOpeningOwnerBorders,", infra_source)

    def test_blocked_chunk_promotion_infra_reschedule_preserves_opening_owner_refresh_policy(self):
        infra_start = self.scenario_refresh_runtime_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        infra_end = self.scenario_refresh_runtime_source.index("function refreshMapDataForScenarioChunkPromotion(", infra_start)
        infra_source = self.scenario_refresh_runtime_source[infra_start:infra_end]
        self.assertRegex(
            infra_source,
            re.compile(
                r'if \(!isInteractionRecoverySettled\(\{ quietMs: 600 \}\)\) \{\s*scheduleDeferredScenarioChunkPromotionInfraRefresh\(\{\s*reason,\s*suppressRender,\s*promotionVersion,\s*hasPoliticalGeometryChange,\s*primaryVisibleDerivedStateReady,\s*completePoliticalDerivedStateReady,\s*primaryDerivedStateReady,\s*refreshOpeningOwnerBorders,\s*\}\);',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
