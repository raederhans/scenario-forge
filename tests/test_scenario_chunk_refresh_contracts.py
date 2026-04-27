import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_PATH = ROOT / "js/core/map_renderer.js"
SCENARIO_RESOURCES_PATH = ROOT / "js/core/scenario_resources.js"
SCENARIO_CHUNK_RUNTIME_PATH = ROOT / "js/core/scenario/chunk_runtime.js"
SCENARIO_POST_APPLY_EFFECTS_PATH = ROOT / "js/core/scenario_post_apply_effects.js"
MAIN_JS_PATH = ROOT / "js/main.js"
DEFERRED_DETAIL_PROMOTION_PATH = ROOT / "js/bootstrap/deferred_detail_promotion.js"
SCENARIO_RUNTIME_STATE_PATH = ROOT / "js/core/state/scenario_runtime_state.js"


class ScenarioChunkRefreshContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.map_renderer_source = MAP_RENDERER_PATH.read_text(encoding="utf-8")
        cls.scenario_resources_source = SCENARIO_RESOURCES_PATH.read_text(encoding="utf-8")
        cls.scenario_chunk_runtime_source = SCENARIO_CHUNK_RUNTIME_PATH.read_text(encoding="utf-8")
        cls.scenario_post_apply_effects_source = SCENARIO_POST_APPLY_EFFECTS_PATH.read_text(encoding="utf-8")
        cls.main_source = MAIN_JS_PATH.read_text(encoding="utf-8")
        cls.deferred_detail_promotion_source = DEFERRED_DETAIL_PROMOTION_PATH.read_text(encoding="utf-8")
        cls.scenario_runtime_state_source = SCENARIO_RUNTIME_STATE_PATH.read_text(encoding="utf-8")

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

    def test_schedule_render_phase_idle_short_circuits_for_active_promotion_work(self):
        self.assertIn('const promotionWorkActive = [', self.map_renderer_source)
        self.assertIn('"promotion-commit-started"', self.map_renderer_source)
        self.assertIn('"promotion-commit-in-flight"', self.map_renderer_source)
        self.assertNotIn('const executedPendingChunkRefresh = pendingChunkRefreshStatus === "executed";', self.map_renderer_source)
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'const promotionWorkActive = \[[\s\S]*?\]\.includes\(String\(pendingChunkRefreshStatus \|\| ""\)\);\s*if \(shouldStartExactAfterSettleFastPath\(\)\) \{\s*if \(promotionWorkActive\) \{\s*return;',
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
        self.assertIn('if (!flushPending || !hasPendingReason) {', self.scenario_chunk_runtime_source)

    def test_political_chunk_promotion_refreshes_union_of_previous_and_next_feature_ids(self):
        self.assertIn('const previousFeatureIds = getScenarioFeatureCollectionIdentityList(runtimeState.scenarioPoliticalChunkData);', self.scenario_chunk_runtime_source)
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
        self.assertIn('promotionRetryCount: 0,', self.scenario_runtime_state_source)
        self.assertIn('lastPromotionRetryAt: 0,', self.scenario_runtime_state_source)
        self.assertIn('runtimeState.runtimeChunkLoadState.promotionRetryCount = Math.max(', self.scenario_chunk_runtime_source)
        self.assertIn('runtimeState.runtimeChunkLoadState.lastPromotionRetryAt = Math.max(', self.scenario_chunk_runtime_source)


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

    def test_post_ready_scheduler_exposes_pending_task_diagnostics(self):
        self.assertIn("let postReadyTaskDiagnostics = new Map();", self.main_source)
        self.assertIn("function resolvePostReadyIdleBlockReason(", self.main_source)
        self.assertIn('if (runtimeState.deferExactAfterSettle) return "defer-exact-after-settle";', self.main_source)
        self.assertIn('if (!allowChunkBacklog && runtimeState.runtimeChunkLoadState?.pendingInfraPromotion) return "chunk-infra-promotion";', self.main_source)
        self.assertIn('if (runtimeState.interactionInfrastructureBuildInFlight) return "interaction-infra-in-flight";', self.main_source)
        self.assertIn("runtimeState.renderPerfMetrics.postReadySchedulerState", self.main_source)
        self.assertIn("pendingTaskKeys", self.main_source)
        self.assertIn("maxRetryCount", self.main_source)
        self.assertIn("reasonStateHint", self.main_source)
        self.assertIn("allowChunkBacklog = false", self.main_source)
        self.assertIn("allowChunkBacklog: true", self.deferred_detail_promotion_source)
        self.assertRegex(
            self.main_source,
            re.compile(
                r'function startDeferredFullInteractionInfrastructureBuild\(.*?'
                r'if \(runtimeState\.detailDeferred && !runtimeState\.detailPromotionCompleted\) \{.*?'
                r'startDeferredFullInteractionInfrastructureBuild',
                re.S,
            ),
        )

    def test_zoom_end_and_visual_stage_metrics_share_selection_context(self):
        self.assertIn("requiredChunkCount", self.scenario_chunk_runtime_source)
        self.assertIn("activePostReadyTaskKey", self.scenario_chunk_runtime_source)
        self.assertIn("promotionRetryCount", self.scenario_chunk_runtime_source)
        self.assertIn("selectionVersion:", self.map_renderer_source)
        self.assertIn("requiredPoliticalChunkCount,", self.map_renderer_source)
        self.assertIn("queueMs:", self.map_renderer_source)

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
            self.map_renderer_source,
            re.compile(r'const taskKey = "scenario-chunk-promotion-infra";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'const previousInteractionInfrastructureStage = String\(runtimeState\.interactionInfrastructureStage \|\| ""\);.*?'
                r'await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*keepReady: true,\s*\}\);.*?'
                r'setInteractionInfrastructureState\(previousInteractionInfrastructureStage \|\| "basic-ready", \{\s*ready: true,\s*inFlight: false,',
                re.S,
            ),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(r'const taskKey = "secondary-spatial-index";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(r'const taskKey = "deferred-heavy-border-meshes";.*?recordInteractionRecoveryTaskMetric\(taskKey,', re.S),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'beginExactAfterSettleControllerSchedule\(scheduleStartedAt\);.*?'
                r'isExactAfterSettleGenerationCurrent\(generation, "scheduled"\).*?'
                r'if \(!runtimeState\.deferExactAfterSettle\) \{.*?'
                r'resetExactAfterSettleController\("defer-cleared", generation\);.*?'
                r'if \(runtimeState\.renderPhase !== RENDER_PHASE_IDLE\) \{.*?'
                r'scheduleExactAfterSettleRefresh\(resolvedProfile\);.*?return;',
                re.S,
            ),
        )
        self.assertRegex(
            self.map_renderer_source,
            re.compile(
                r'drewExactFrame = composeCachedPasses\(RENDER_PASS_NAMES\);.*?'
                r'finalizePendingExactAfterSettleRefreshAfterPaint\(\);',
                re.S,
            ),
        )
        self.assertIn('recordRenderPerfMetric("settleExactRefreshApply"', self.map_renderer_source)
        self.assertIn('recordRenderPerfMetric("settleExactRefreshWaitForPaint"', self.map_renderer_source)
        self.assertIn('recordRenderPerfMetric("settleExactRefreshFinalize"', self.map_renderer_source)
        interaction_blocker = re.search(
            r"function isInteractionRecoveryBlocked\(\) \{(?P<body>.*?)\n\}",
            self.map_renderer_source,
            re.S,
        )
        self.assertIsNotNone(interaction_blocker)
        self.assertIn("activeInteractionRecoveryTaskKey", interaction_blocker.group("body"))
        self.assertIn("isExactAfterSettleControllerActive()", interaction_blocker.group("body"))
        self.assertNotIn("activePostReadyTaskKey", interaction_blocker.group("body"))

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
                r'if \(flushPending\) \{\s*return executeScenarioChunkRefreshNow\(\{\s*bundle,\s*reason: nextReason,\s*flushPending,\s*allowRefreshStart: hadPendingReason,',
                re.S,
            ),
        )
        self.assertIn('setScenarioChunkShellStatus("ready", loadState);', self.scenario_chunk_runtime_source)

    def test_ready_state_flushes_pending_scenario_chunk_refresh_before_deferred_full_interaction(self):
        self.assertIn('function scheduleReadyPostBootWork(renderDispatcher, reason = "ready-state")', self.main_source)
        self.assertRegex(
            self.main_source,
            re.compile(
                r'function scheduleReadyPostBootWork\(renderDispatcher, reason = "ready-state"\) \{[\s\S]*?completeBootSequenceLogging\(\);[\s\S]*?flushPendingScenarioChunkRefreshAfterReady\(reason\);[\s\S]*?scheduleDeferredDetailPromotion\(renderDispatcher\);[\s\S]*?startDeferredFullInteractionInfrastructureBuild\(reason\);',
                re.S,
            ),
        )
        self.assertGreaterEqual(self.main_source.count('scheduleReadyPostBootWork(renderDispatcher, "ready-state");'), 2)
        self.assertRegex(
            self.main_source,
            re.compile(
                r'runtimeState\.scheduleScenarioChunkRefreshFn\(\{\s*reason: normalizedReason,\s*delayMs: 0,\s*flushPending: true,',
                re.S,
            ),
        )
        self.assertIn("const shouldSeedFirstReadyFlush = !!(", self.main_source)
        self.assertIn("loadState.pendingReason = normalizedReason;", self.main_source)
        self.assertIn("loadState.pendingDelayMs = 0;", self.main_source)

    def test_pending_promotion_keeps_same_selection_version_across_visual_infra_and_commit_payload(self):
        self.assertRegex(
            self.scenario_chunk_runtime_source,
            re.compile(
                r'const nextSelectionVersion = Math\.max\(0, Number\(loadState\.selectionVersion \|\| 0\)\) \+ 1;\s*loadState\.selectionVersion = nextSelectionVersion;[\s\S]*?pendingVisualPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?pendingInfraPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,[\s\S]*?pendingPromotion = \{[\s\S]*?selectionVersion: nextSelectionVersion,',
                re.S,
            ),
        )

    def test_timer_handle_check_requires_live_timer_shape(self):
        self.assertIn('if (runtimeState.runtimeChunkLoadState.promotionTimerId && !isTimerHandle(runtimeState.runtimeChunkLoadState.promotionTimerId)) {', self.scenario_chunk_runtime_source)
        self.assertIn('return Number.isFinite(value);', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.ref === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.unref === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.hasRef === "function"', self.scenario_chunk_runtime_source)
        self.assertIn('typeof value.refresh === "function"', self.scenario_chunk_runtime_source)

    def test_promotion_pipeline_uses_single_commit_entrypoint(self):
        self.assertIn('schedulePendingScenarioChunkPromotionCommit({', self.scenario_chunk_runtime_source)
        self.assertIn('let promotionCommitPromise = null;', self.scenario_chunk_runtime_source)
        self.assertIn('let promotionCommitRunId = 0;', self.scenario_chunk_runtime_source)
        self.assertIn('void commitPendingScenarioChunkPromotion().catch((error) => {', self.scenario_chunk_runtime_source)
        self.assertIn('return "promotion-commit-started";', self.scenario_chunk_runtime_source)
        self.assertIn('return "promotion-commit-in-flight";', self.scenario_chunk_runtime_source)
        self.assertIn('await yieldToFrame();', self.scenario_chunk_runtime_source)
        self.assertNotIn("function commitScenarioChunkPromotion(", self.scenario_chunk_runtime_source)
        self.assertNotIn("function storePendingScenarioChunkPromotion(", self.scenario_chunk_runtime_source)

    def test_promotion_commit_replays_pending_refresh_after_single_flight(self):
        self.assertIn("pendingPostCommitRefresh", self.scenario_chunk_runtime_source)
        self.assertIn("scheduleScenarioChunkRefresh({", self.scenario_chunk_runtime_source)
        self.assertIn('committedReason === "zoom-end"', self.scenario_chunk_runtime_source)
        self.assertIn('reason: replayReason,', self.scenario_chunk_runtime_source)
        self.assertNotIn('clearPendingScenarioChunkRefresh(loadState);\n        return "promotion-commit-in-flight";', self.scenario_chunk_runtime_source)


    def test_zoom_end_detail_chunks_are_protected_through_exact_settle_replay(self):
        self.assertIn("function protectZoomEndChunks(loadState, chunkIds = [], {", self.scenario_chunk_runtime_source)
        self.assertIn("function clearZoomEndChunkProtection(loadState)", self.scenario_chunk_runtime_source)
        self.assertIn("function isZoomEndChunkProtectionContextValid(protectionState = {}, {", self.scenario_chunk_runtime_source)
        self.assertIn("function protectZoomEndChunksForSelection(loadState, chunkIds = [], {", self.scenario_chunk_runtime_source)
        self.assertIn("function applyZoomEndChunkProtectionToSelection(selection, loadState, {", self.scenario_chunk_runtime_source)
        self.assertIn("function applyZoomEndChunkProtection(selection, loadState, {", self.scenario_chunk_runtime_source)
        self.assertIn("selectionVersion: pendingPromotion.selectionVersion || loadState.selectionVersion || 0", self.scenario_chunk_runtime_source)
        self.assertIn("selectionVersion: Math.max(0, Number(loadState.selectionVersion || 0))", self.scenario_chunk_runtime_source)
        self.assertIn("clearZoomEndChunkProtectionState(loadState);", self.scenario_chunk_runtime_source)
        self.assertIn("zoomEndProtectedChunkIds", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedUntil", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedSelectionVersion", self.scenario_runtime_state_source)
        self.assertIn("zoomEndProtectedFocusCountry", self.scenario_runtime_state_source)

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
                r'applyZoomEndChunkProtectionToSelection\(selection, loadState, \{[\s\S]*?'
                r'reason = "",[\s\S]*?previousSelection = null,[\s\S]*?'
                r'isZoomEndChunkProtectionContextValid\(\{[\s\S]*?zoomEndProtectedSelectionVersion[\s\S]*?zoomEndProtectedFocusCountry[\s\S]*?\}, \{[\s\S]*?\}\)[\s\S]*?'
                r'isZoomEndChunkProtectionContextValid\(\{[\s\S]*?previousSelection\?\.selectionVersion[\s\S]*?previousSelection\?\.focusCountry[\s\S]*?\}, \{[\s\S]*?\}\)',
                re.S,
            ),
        )

    def test_promotion_commit_can_be_cancelled_by_runtime_hook(self):
        self.assertIn('import { registerRuntimeHook } from "../state/index.js";', self.scenario_chunk_runtime_source)
        self.assertIn('function cancelScenarioChunkPromotionCommit(reason = "cancel")', self.scenario_chunk_runtime_source)
        self.assertIn('registerRuntimeHook(runtimeState, "cancelScenarioChunkPromotionCommitFn", cancelScenarioChunkPromotionCommit);', self.scenario_chunk_runtime_source)

    def test_chunk_promotion_visual_apply_yields_under_render_lock_and_revalidates(self):
        visual_start = self.scenario_chunk_runtime_source.index('setPromotionCommitStatus(loadState, "applying-visual"')
        visual_end = self.scenario_chunk_runtime_source.index('recordScenarioChunkRuntimeMetric("chunkPromotionCommitVisualMs"', visual_start)
        visual_slice = self.scenario_chunk_runtime_source[visual_start:visual_end]

        self.assertIn("applyScenarioPoliticalChunkPayload(", visual_slice)
        self.assertIn("await yieldToFrame();", visual_slice)
        self.assertIn("isPendingScenarioChunkPromotionCurrent(pendingPromotion, loadState, { scenarioId, runId })", visual_slice)
        self.assertIn("runtimeState.scenarioPoliticalChunkData = previousPoliticalChunkData;", visual_slice)
        self.assertIn('reason: "scenario-chunk-promotion-stale-rollback"', visual_slice)
        self.assertRegex(
            visual_slice,
            re.compile(
                r'await yieldToFrame\(\);.*?'
                r'if \(!isPendingScenarioChunkPromotionCurrent.*?'
                r'flushRenderBoundary\("scenario-chunk-promotion"\);.*?'
                r'runtimeState\.scenarioChunkPromotionRenderLocked = previousRenderLock;',
                re.S,
            ),
        )

    def test_chunk_promotion_infra_does_not_rebuild_static_meshes(self):
        start = self.map_renderer_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        end = self.map_renderer_source.index("function refreshMapDataForScenarioChunkPromotion(", start)
        promotion_infra_source = self.map_renderer_source[start:end]
        self.assertIn('if (hasPoliticalGeometryChange) {', promotion_infra_source)
        self.assertIn('ensureSovereigntyState();', promotion_infra_source)
        self.assertIn('if (refreshOpeningOwnerBorders !== false) {', promotion_infra_source)
        self.assertIn('refreshScenarioOpeningOwnerBorders({', promotion_infra_source)
        self.assertIn('invalidateBorderCache();', promotion_infra_source)
        self.assertNotIn('rebuildStaticMeshes();', promotion_infra_source)

    def test_political_chunk_promotion_clears_stale_internal_border_meshes_before_visual_render(self):
        helper_start = self.map_renderer_source.index("function clearDeferredInternalBorderMeshCaches(")
        helper_end = self.map_renderer_source.index("function buildDetailAdmMeshSignature", helper_start)
        helper_source = self.map_renderer_source[helper_start:helper_end]
        self.assertIn("setStaticMeshSourceCountries(getSourceCountrySets());", helper_source)
        self.assertIn("runtimeState.cachedProvinceBorders = [];", helper_source)
        self.assertIn("runtimeState.cachedProvinceBordersByCountry = new Map();", helper_source)
        self.assertIn("runtimeState.cachedLocalBorders = [];", helper_source)
        self.assertIn("runtimeState.cachedLocalBordersByCountry = new Map();", helper_source)
        self.assertIn("runtimeState.cachedDetailAdmBorders = [];", helper_source)
        self.assertIn("runtimeState.cachedGridLines = [];", helper_source)
        self.assertIn("resetVisibleInternalBorderMeshSignature();", helper_source)
        self.assertIn("resetDetailAdmMeshBuildState();", helper_source)
        self.assertIn("syncStaticMeshSnapshot();", helper_source)

        promotion_start = self.map_renderer_source.index("function refreshMapDataForScenarioChunkPromotion(")
        promotion_end = self.map_renderer_source.index("function refreshMapDataForScenarioApply(", promotion_start)
        promotion_source = self.map_renderer_source[promotion_start:promotion_end]
        self.assertRegex(
            promotion_source,
            re.compile(
                r'if \(hasPoliticalChange\) \{\s*refreshResolvedColorsForFeatures\(politicalFeatureIds, \{ renderNow: false \}\);\s*clearDeferredInternalBorderMeshCaches\(\);\s*scheduleDeferredHeavyBorderMeshes\(\);\s*\}',
                re.S,
            ),
        )

    def test_scenario_apply_refresh_still_rebuilds_static_meshes(self):
        self.assertRegex(
            self.map_renderer_source,
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
        start = self.map_renderer_source.index("function refreshMapDataForScenarioChunkPromotion(")
        end = self.map_renderer_source.index("function refreshMapDataForScenarioApply(", start)
        promotion_source = self.map_renderer_source[start:end]
        self.assertIn("const shouldRefreshOpeningOwnerBordersInVisual =", promotion_source)
        self.assertIn("refreshOpeningOwnerBorders: !shouldRefreshOpeningOwnerBordersInVisual,", promotion_source)
        self.assertIn("if (shouldRefreshOpeningOwnerBordersInVisual) {", promotion_source)
        infra_start = self.map_renderer_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        infra_end = self.map_renderer_source.index("function refreshMapDataForScenarioChunkPromotion(", infra_start)
        infra_source = self.map_renderer_source[infra_start:infra_end]
        self.assertIn("refreshOpeningOwnerBorders = true,", infra_source)
        self.assertIn("refreshOpeningOwnerBorders,", infra_source)

    def test_blocked_chunk_promotion_infra_reschedule_preserves_opening_owner_refresh_policy(self):
        infra_start = self.map_renderer_source.index("async function runDeferredScenarioChunkPromotionInfraRefresh(")
        infra_end = self.map_renderer_source.index("function refreshMapDataForScenarioChunkPromotion(", infra_start)
        infra_source = self.map_renderer_source[infra_start:infra_end]
        self.assertRegex(
            infra_source,
            re.compile(
                r'if \(!isInteractionRecoverySettled\(\{ quietMs: 600 \}\)\) \{\s*scheduleDeferredScenarioChunkPromotionInfraRefresh\(\{\s*reason,\s*suppressRender,\s*promotionVersion,\s*hasPoliticalGeometryChange,\s*refreshOpeningOwnerBorders,\s*\}\);',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
