from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
REFRESH_PLANS_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_plans.js"
SCENARIO_REFRESH_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_runtime.js"
HIT_CANDIDATES_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "interaction_hit_candidates.js"


class MapRendererSpatialIndexRuntimeOrchestrationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        cls.refresh_plan_content = REFRESH_PLANS_JS.read_text(encoding="utf-8")
        cls.refresh_runtime_content = SCENARIO_REFRESH_RUNTIME_JS.read_text(encoding="utf-8")
        cls.hit_candidate_content = HIT_CANDIDATES_JS.read_text(encoding="utf-8")

    def assert_secondary_spatial_rebuild_order(self, body, *, allow_work_between_rebuild_and_reset=False):
        gap = r'[\s\S]*?' if allow_work_between_rebuild_and_reset else r'\s*'
        self.assertRegex(
            body,
            re.compile(
                r'rebuildAuxiliaryRegionIndexes\(\);'
                + gap +
                r'getSpatialIndexRuntimeOwner\(\)\.resetSecondarySpatialIndexState\(\{\s*'
                r'preserveCurrent: true,\s*'
                r'reason:[\s\S]*?'
                r'\}\);\s*'
                r'getSpatialIndexRuntimeOwner\(\)\.buildSecondarySpatialIndexes\(\{\s*'
                r'allowComputeMissingBounds: true,\s*'
                r'\}\);',
                re.S,
            ),
        )

    def test_basic_interaction_startup_keeps_chunked_index_then_spatial_order(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'if \(chunked\) \{\s*await buildIndexChunked\(\{ scheduleUiMode: "deferred", isCurrent: taskContext\?\.isCurrent, yieldControl: \(\) => yieldInteractionInfrastructureBuild\(taskContext\) \}\);'
                r'\s*taskContext\?\.throwIfStale\(\);\s*await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*isCurrent: taskContext\?\.isCurrent,\s*yieldControl: \(\) => yieldInteractionInfrastructureBuild\(taskContext\),\s*\}\);'
                r'\s*\} else \{\s*buildIndex\(\{ scheduleUiMode: "deferred" \}\);\s*buildSpatialIndex\(\{\s*includeSecondary: false,\s*\}\);\s*\}',
                re.S,
            ),
        )


    def test_spatial_owner_pass_through_calls_owner_directly(self):
        self.assertNotRegex(self.renderer_content, r"(?m)^\s*(?:const|let|var)\s+resetSecondarySpatialIndexState\s*=")
        self.assertNotRegex(self.renderer_content, r"(?m)^\s*function\s+resetSecondarySpatialIndexState\s*\(")
        self.assertNotRegex(self.renderer_content, r"(?m)^\s*(?:const|let|var)\s+buildSecondarySpatialIndexes\s*=")
        self.assertNotRegex(self.renderer_content, r"(?m)^\s*function\s+buildSecondarySpatialIndexes\s*\(")
        combined_runtime_content = f"{self.renderer_content}\n{self.refresh_runtime_content}"
        self.assertEqual(combined_runtime_content.count("getSpatialIndexRuntimeOwner().resetSecondarySpatialIndexState({"), 3)
        self.assertEqual(combined_runtime_content.count("getSpatialIndexRuntimeOwner().buildSecondarySpatialIndexes({"), 3)
        self.assertNotIn("facade_spatial_runtime.js", self.renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildIndex(...args);", self.renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildIndexChunked(...args);", self.renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildSpatialIndex(...args);", self.renderer_content)
        self.assertIn("return getSpatialIndexRuntimeOwner().buildSpatialIndexChunked(...args);", self.renderer_content)

    def test_chunk_promotion_visual_stage_reuses_primary_derived_state_rebuild(self):
        self.assertIn("function rebuildPrimaryPoliticalDerivedState({", self.renderer_content)
        helper_start = self.renderer_content.index("function rebuildPrimaryPoliticalDerivedState({")
        helper_end = self.renderer_content.index("function setMapData({", helper_start)
        helper_body = self.renderer_content[helper_start:helper_end]
        self.assertRegex(
            helper_body,
            re.compile(
                r'rebuildPrimaryPoliticalCollections\(\);[\s\S]*?'
                r'rebuildRuntimeDerivedState\(\{\s*includeRuntimePoliticalMeta: true,\s*scheduleUiMode,\s*buildSpatial,\s*includeSecondarySpatial,\s*\}\);',
                re.S,
            ),
        )
        self.assertRegex(
            self.refresh_plan_content,
            re.compile(
                r'function getScenarioChunkPromotionTargetPasses\(\{[\s\S]*?return getTargetPassesForResources\(getScenarioChunkPromotionTargetResources\(\{[\s\S]*?function getScenarioChunkPromotionTargetResources\(\{[\s\S]*?if \(hasPoliticalChange\) \{\s*addResources\(\[\s*"politicalBaseBuffer",\s*"hitIndex",\s*"contextBaseBuffer",\s*"contextMarkersBuffer",\s*"borderBuffer",\s*"interactionOverlay",\s*"labelBuffer",',
                re.S,
            ),
        )
        self.assertRegex(
            self.refresh_runtime_content,
            re.compile(
                r'if \(hasPoliticalChange\) \{[\s\S]*?'
                r'rebuildPrimaryPoliticalDerivedState\(\{\s*scheduleUiMode: "deferred",\s*buildSpatial: true,\s*includeSecondarySpatial: false,\s*\}\);',
                re.S,
            ),
        )

    def test_chunk_promotion_infra_uses_complete_derived_state_readiness(self):
        self.assertRegex(
            self.refresh_runtime_content,
            re.compile(
                r'async function runDeferredScenarioChunkPromotionInfraRefresh\(\{[\s\S]*?'
                r'primaryVisibleDerivedStateReady = false,[\s\S]*?completePoliticalDerivedStateReady = false,[\s\S]*?'
                r'let resolvedCompletePoliticalDerivedStateReady = !!completePoliticalDerivedStateReady[\s\S]*?'
                r'else if \(!resolvedCompletePoliticalDerivedStateReady\) \{\s*'
                r'const indexStartedAt = nowMs\(\);\s*infrastructureMutationStarted = true;\s*execution.mutationStarted = true;\s*'
                r'buildIndex\(\);\s*preliminaryIndexBuildMs = nowMs\(\) - indexStartedAt;\s*await yieldToMain\(\);\s*'
                r'yieldCount \+= 1;\s*if \(!isCurrent\(\)\) \{\s*return false;\s*\}\s*'
                r'const spatialStartedAt = nowMs\(\);\s*await buildSpatialIndexChunked\(\{\s*includeSecondary: false,\s*keepReady: true,\s*isCurrent,\s*\}\);\s*'
                r'if \(!isCurrent\(\)\) return false;\s*preliminarySpatialBuildMs = nowMs\(\) - spatialStartedAt;\s*\}[\s\S]*?'
                r'scheduleSecondarySpatialIndexBuild\(\{',
                re.S,
            ),
        )
        start = self.refresh_runtime_content.index("if (shouldRestoreFullPoliticalDerivedState) {")
        end = self.refresh_runtime_content.index("} else if (!resolvedCompletePoliticalDerivedStateReady)", start)
        restore_wait = self.refresh_runtime_content[start:end]
        self.assertIn("await yieldToMain();", restore_wait)
        self.assertIn("if (!isCurrent()) return false;", restore_wait)
        self.assertNotIn("buildIndex(", restore_wait)
        self.assertNotIn("buildSpatialIndexChunked(", restore_wait)

    def test_chunk_promotion_water_and_special_sync_secondary_indexes_before_deferred_infra(self):
        start = self.renderer_content.index("function syncScenarioSecondaryRegionIndexes({")
        end = self.renderer_content.index("function rebuildRuntimeDerivedState({", start)
        sync_body = self.renderer_content[start:end]
        self.assert_secondary_spatial_rebuild_order(sync_body)
        self.assertIn(
            'const hasWaterChange = normalizedLayerKeys.has("water") || normalizedLayerKeys.has("scenario_atlantropa");',
            sync_body,
        )
        self.assertIn("renderWaterRegionList: hasWaterChange,", sync_body)
        self.assertIn("hasWaterChange,", sync_body)
        self.assertRegex(
            self.refresh_runtime_content,
            re.compile(
                r'const synchronizedSecondaryRegionIndexes = syncScenarioSecondaryRegionIndexes\(\{\s*'
                r'changedLayerKeys: effectiveChangedLayerKeys,\s*'
                r'reason: `\$\{reason\}-secondary-sync`,\s*'
                r'\}\);',
                re.S,
            ),
        )

    def test_all_secondary_spatial_rebuild_paths_preserve_current_snapshot_until_next_build(self):
        start = self.renderer_content.index("function scheduleSecondarySpatialIndexBuild({")
        end = self.renderer_content.index("function syncScenarioSecondaryRegionIndexes({", start)
        self.assert_secondary_spatial_rebuild_order(self.renderer_content[start:end])

        start = self.renderer_content.index("function syncScenarioSecondaryRegionIndexes({")
        end = self.renderer_content.index("function rebuildRuntimeDerivedState({", start)
        self.assert_secondary_spatial_rebuild_order(self.renderer_content[start:end])

        start = self.refresh_runtime_content.index("function refreshMapDataForScenarioApply({")
        end = self.refresh_runtime_content.index("\n  return {", start)
        self.assert_secondary_spatial_rebuild_order(
            self.refresh_runtime_content[start:end],
            allow_work_between_rebuild_and_reset=True,
        )
        combined_runtime_content = f"{self.renderer_content}\n{self.refresh_runtime_content}"
        self.assertEqual(combined_runtime_content.count("preserveCurrent: true"), 3)

    def test_secondary_spatial_demand_metric_only_records_new_pending_build(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'const hadPendingBuild = secondarySpatialBuildHandle !== null && secondarySpatialBuildHandle !== undefined;\s*pendingSecondarySpatialBuildReasons\.add\(normalizedReason\);\s*if \(!hadPendingBuild\) \{\s*incrementPerfCounter\("interactionSecondaryIndexDemandCount"\);\s*recordRenderPerfMetric\("interactionSecondaryIndexDemandCount", 0, \{[\s\S]*?pendingReasonCount: pendingSecondarySpatialBuildReasons\.size,',
                re.S,
            ),
        )

    def test_hover_hit_keeps_reduced_phase_before_precise_hit_resolution(self):
        hover_content = (MAP_RENDERER_JS.parent / "map_renderer" / "map_hover_interaction_owner.js").read_text(encoding="utf-8")
        binding_start = self.renderer_content.index("function getMapHoverInteractionOwner() {")
        binding = self.renderer_content[binding_start:self.renderer_content.index("function getVisibleFrameDiagnosticsOwner()", binding_start)]
        self.assertIn("mapHoverInteractionOwner = createMapHoverInteractionOwner({", binding)
        self.assertIn("state: runtimeState,", binding)
        self.assertIn("hoverSnapPx: HIT_SNAP_RADIUS_HOVER_PX", binding)
        self.assertIn("renderPhaseIdle: RENDER_PHASE_IDLE", binding)
        self.assertIn("      getHitFromEvent,", binding)
        self.assertRegex(self.renderer_content, r"function handleMouseMove\(event\) \{\s*getMapHoverInteractionOwner\(\)\.handleMouseMove\(event\);\s*\}")
        self.assertRegex(hover_content, r"function isReducedHoverPhase\(\) \{\s*return Boolean\(state\.renderPhase !== renderPhaseIdle \|\| state\.isInteracting \|\| state\.scenarioApplyInFlight\s*\|\| state\.startupReadonly \|\| state\.startupReadonlyUnlockInFlight\);")
        self.assertRegex(
            hover_content,
            re.compile(
                r'function handleMouseMove\(event\) \{[\s\S]*?if \(isReducedHoverPhase\(\)\) \{\s*return clearReducedHover\(\);\s*\}\s*const hit = getterApi.getHitFromEvent\(event, \{\s*enableSnap: false,\s*snapPx: hoverSnapPx,\s*eventType: "hover",\s*\}\) \|\| \{\};',
                re.S,
            ),
        )

    def test_hit_rank_metric_carries_candidate_and_target_shape(self):
        self.assertRegex(
            self.hit_candidate_content,
            re.compile(
                r'function rankCandidates\([\s\S]*?candidates,[\s\S]*?lonLat,[\s\S]*?eventType = "unknown",[\s\S]*?targetType = "unknown",[\s\S]*?let geoContainsCount = 0;[\s\S]*?geoContainsCount \+= 1;[\s\S]*?recordInteractionDurationMetric\("interactionHitRankDuration", nowMs\(\) - startedAt, \{[\s\S]*?candidateCount: candidates\.length,[\s\S]*?geoContainsCount,[\s\S]*?containsGeoCount:[\s\S]*?eventType,[\s\S]*?targetType,',
                re.S,
            ),
        )
        self.assertIn("rankCandidates as rankHitCandidates,", self.renderer_content)
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'function rankCandidates\(candidates, lonLat,[\s\S]*?return rankHitCandidates\(candidates, lonLat,[\s\S]*?geoContains: globalThis\.d3\?\.geoContains,[\s\S]*?recordInteractionDurationMetric,',
                re.S,
            ),
        )

    def test_hit_canvas_keeps_dirty_when_spatial_index_is_unavailable(self):
        start = self.renderer_content.index("function drawHitCanvas()")
        end = self.renderer_content.index("function drawHitCanvasWithMetric", start)
        draw_hit_canvas = self.renderer_content[start:end]

        self.assertIn("if (visibleSpatialItemsResult === null) {", draw_hit_canvas)
        self.assertIn("runtimeState.hitCanvasDirty = true;", draw_hit_canvas)
        self.assertIn('recordRenderPerfMetric("hitCanvasSpatialIndexUnavailable"', draw_hit_canvas)
        self.assertNotIn("runtimeState.landData.features.forEach", draw_hit_canvas)

    def test_forced_hit_canvas_reuses_current_canvas_before_rebuild(self):
        start = self.renderer_content.index("function ensureHitCanvasUpToDate")
        end = self.renderer_content.index("function isHitCanvasCurrent", start)
        ensure_hit_canvas = self.renderer_content[start:end]

        self.assertRegex(
            ensure_hit_canvas,
            re.compile(
                r'if \(!runtimeState\.hitCanvasDirty && isHitCanvasCurrent\(\)\) \{\s*'
                r'recordRenderPerfMetric\("buildHitCanvas", 0, \{[\s\S]*?'
                r'built: false,[\s\S]*?'
                r'skipped: true,[\s\S]*?'
                r'reason: "current",[\s\S]*?'
                r'return true;',
                re.S,
            ),
        )
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'function drawHitCanvasWithMetric\(details = \{\}\) \{[\s\S]*?'
                r'const dirtyBefore = !!runtimeState\.hitCanvasDirty;[\s\S]*?'
                r'dirtyBefore,',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
