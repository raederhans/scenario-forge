from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
DEFERRED_DETAIL_PROMOTION_JS = REPO_ROOT / "js" / "bootstrap" / "deferred_detail_promotion.js"
STARTUP_READY_HANDOFF_JS = REPO_ROOT / "js" / "bootstrap" / "startup_ready_handoff.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
SCENARIO_REFRESH_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_runtime.js"
SCENARIO_CHUNK_PROMOTION_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "scenario_chunk_promotion_helpers.js"


class MainDeferredDetailPromotionBoundaryContractTest(unittest.TestCase):
    def test_main_imports_deferred_detail_promotion_owner(self):
        content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("./bootstrap/deferred_detail_promotion.js", content.replace('"', "'"))
        self.assertIn("createDeferredDetailPromotionOwner", content)
        self.assertIn("let deferredDetailPromotionOwner = null;", content)
        self.assertIn("function getDeferredDetailPromotionOwner() {", content)

    def test_owner_keeps_detail_promotion_transaction_and_internal_handles(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")
        owner_content = DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8")

        self.assertIn("const MAX_FORCED_STARTUP_INFRA_RETRIES = 2;", owner_content)
        self.assertIn("let deferredPromotionHandle = null;", owner_content)
        self.assertIn("let forcedStartupReadonlyInfraRetryCount = 0;", owner_content)
        self.assertIn("export function createDeferredDetailPromotionOwner({", owner_content)
        self.assertIn("function hasDetailTopologyLoaded()", owner_content)
        self.assertIn("function prioritizeViewportFocusCountry({", owner_content)
        self.assertIn("function syncScenarioReadyUiAfterDetailPromotion()", owner_content)
        self.assertIn("function applyDetailPromotionMapRefresh({", owner_content)
        self.assertIn("function shouldAdoptDeferredRuntimePoliticalTopology()", owner_content)
        self.assertIn("async function ensureDetailTopologyReady({", owner_content)
        self.assertIn("async function unlockStartupReadonlyWithDetail(renderDispatcher)", owner_content)
        self.assertIn("function scheduleStartupReadonlyUnlock(", owner_content)
        self.assertIn("function scheduleDeferredDetailPromotion(renderDispatcher)", owner_content)
        self.assertIn("loadDeferredDetailBundle({", owner_content)
        self.assertIn("refreshScenarioDataHealth({", owner_content)
        self.assertIn("buildInteractionInfrastructureAfterStartup({", owner_content)
        self.assertIn("getDeferredPromotionDelay(runtimeState.renderProfile)", owner_content)
        self.assertIn("schedulePostReadyPoliticalReconcile", donor_content)
        self.assertIn("schedulePostReadyPoliticalReconcile", owner_content)
        self.assertIn("tryScheduleStartupSampleProjectDeeplink", owner_content)
        self.assertEqual(owner_content.count("void tryScheduleStartupSampleProjectDeeplink?.();"), 2)

        self.assertNotIn("loadDeferredDetailBundle({", donor_content)
        self.assertNotIn("refreshScenarioDataHealth({", donor_content)
        self.assertNotIn("getDeferredPromotionDelay(runtimeState.renderProfile)", donor_content)

    def test_detail_promotion_recolors_then_defers_political_reconcile(self):
        owner_content = DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8")
        startup_ready_handoff_content = STARTUP_READY_HANDOFF_JS.read_text(encoding="utf-8")

        self.assertIn(
            "refreshMapDataForScenarioApply({ suppressRender: true });",
            owner_content,
        )
        self.assertRegex(
            owner_content,
            re.compile(
                r"if \(hasActiveScenario\) \{\s*"
                r"refreshMapDataForScenarioApply\(\{ suppressRender: true \}\);\s*"
                r"return \"light\";\s*"
                r"\}",
                re.S,
            ),
        )
        self.assertNotIn("setMapData-fallback", owner_content)
        self.assertNotIn("falling back to setMapData", owner_content)
        self.assertIn(
            "if (!String(runtimeState.activeScenarioId || \"\").trim())",
            owner_content,
        )
        self.assertIn("function shouldAdoptDeferredRuntimePoliticalTopology()", owner_content)
        self.assertIn("return !runtimeState.runtimePoliticalTopology?.objects?.political;", owner_content)
        self.assertIn("if (shouldAdoptDeferredRuntimePoliticalTopology())", owner_content)
        self.assertIn(
            "runtimeState.runtimePoliticalTopology = runtimePoliticalTopology || runtimeState.runtimePoliticalTopology;",
            owner_content,
        )
        self.assertIn(
            "setDefaultRuntimePoliticalTopologyState(runtimeState);",
            owner_content,
        )
        self.assertNotIn(
            "runtimeState.defaultRuntimePoliticalTopology =",
            owner_content,
        )
        self.assertNotIn("forcePoliticalFullRepaint", owner_content)
        self.assertNotIn("detail-promotion-force", owner_content)
        self.assertRegex(
            owner_content,
            re.compile(
                r"runtimeState\.detailPromotionCompleted = true;\s*"
                r"if \(mapDataRefreshed\) \{\s*"
                r"schedulePostReadyPoliticalReconcile\?\.\(\"detail-topology-ready\"\);",
                re.S,
            ),
        )
        self.assertRegex(
            owner_content,
            re.compile(
                r"const refreshMode = applyDetailPromotionMapRefresh\([\s\S]*?"
                r"mapDataRefreshed = true;[\s\S]*?"
                r"schedulePostReadyPoliticalReconcile\?\.\(\"detail-topology-promoted\"\);",
                re.S,
            ),
        )
        self.assertIn(
            'const DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY = "post-ready-detail-promotion-political-reconcile";',
            startup_ready_handoff_content,
        )
        self.assertRegex(
            startup_ready_handoff_content,
            re.compile(
                r"function schedulePostReadyPoliticalReconcile\(reason = \"detail-promotion-political-reconcile\"\) \{[\s\S]*?"
                r"if \(!targetRuntime\.detailPromotionCompleted\) \{[\s\S]*?"
                r"return false;[\s\S]*?"
                r"return schedulePostReadyPoliticalReconcileTask\(reason\);",
                re.S,
            ),
        )
        self.assertRegex(
            startup_ready_handoff_content,
            re.compile(
                r"function schedulePostReadyPoliticalReconcileTask\(reason = \"detail-promotion-political-reconcile\"\) \{[\s\S]*?"
                r"postReadyScheduler\.scheduleTask\(DETAIL_PROMOTION_POLITICAL_RECONCILE_TASK_KEY, async \(task\) => \{\s*"
                r"task\.throwIfStale\(\);\s*"
                r"while \(!targetRuntime\.detailPromotionCompleted\s*"
                r"\|\| !task\.commit\(\(\) => reconcileDetailPromotionPoliticalPass\(normalizedReason\)\)\) \{\s*"
                r"await task\.yield\(\);\s*\}\s*return true;\s*"
                r"\}, scopedTaskOptions\(\{\s*canStart: \(\) => !!targetRuntime\.detailPromotionCompleted,",
                re.S,
            ),
        )
        self.assertNotIn("schedulePostReadyPoliticalReconcileTask(normalizedReason);", startup_ready_handoff_content)

    def test_main_keeps_wrappers_and_ready_state_facade(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("return getDeferredDetailPromotionOwner().hasDetailTopologyLoaded();", donor_content)
        self.assertIn("return getDeferredDetailPromotionOwner().ensureDetailTopologyReady({", donor_content)
        self.assertIn("return getDeferredDetailPromotionOwner().unlockStartupReadonlyWithDetail(renderDispatcher);", donor_content)
        self.assertIn("return getDeferredDetailPromotionOwner().scheduleStartupReadonlyUnlock(renderDispatcher, {", donor_content)
        self.assertIn("const deferredDetailPromotion = getDeferredDetailPromotionOwner();", donor_content)
        self.assertIn("return deferredDetailPromotion.scheduleDeferredDetailPromotion(renderDispatcher);", donor_content)
        self.assertIn("tryScheduleStartupSampleProjectDeeplink,", donor_content)
        self.assertIn("async function finalizeReadyState(renderDispatcher) {", donor_content)
        self.assertIn("scheduleStartupReadonlyUnlock(renderDispatcher);", donor_content)
        self.assertIn("scheduleDeferredDetailPromotion(renderDispatcher);", donor_content)
        self.assertIn("await finalizeReadyState(renderDispatcher);", donor_content)
        self.assertIsNone(re.search(r"function\s+prioritizeViewportFocusCountry\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+applyDetailPromotionMapRefresh\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+syncScenarioReadyUiAfterDetailPromotion\s*\(", donor_content))

    def test_active_scenario_detail_promotion_refreshes_political_water_and_atlantropa_targets(self):
        owner_content = DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        refresh_runtime_content = SCENARIO_REFRESH_RUNTIME_JS.read_text(encoding="utf-8")
        promotion_helpers_content = SCENARIO_CHUNK_PROMOTION_HELPERS_JS.read_text(encoding="utf-8")

        self.assertRegex(
            owner_content,
            re.compile(
                r"function applyDetailPromotionMapRefresh\([\s\S]*?"
                r"if \(hasActiveScenario\) \{[\s\S]*?"
                r"refreshMapDataForScenarioApply\(\{ suppressRender: true \}\);",
                re.S,
            ),
        )
        self.assertRegex(
            refresh_runtime_content,
            re.compile(
                r"function refreshMapDataForScenarioApply\([\s\S]*?"
                r'targetPasses: \["background", "physicalBase", "political", "contextBase", "contextScenario", "dayNight", "borders", "labels"\],[\s\S]*?'
                r'resetWaterCacheReason: "scenario-switch-complete"',
                re.S,
            ),
        )
        self.assertRegex(
            refresh_runtime_content,
            re.compile(
                r"function refreshMapDataForScenarioApply\([\s\S]*?"
                r"const atlantropaWaterFeatureCount = getEffectiveAtlantropaFeatures\(\)\.water\.length;[\s\S]*?"
                r"rebuildAuxiliaryRegionIndexes\(\);[\s\S]*?"
                r"getSpatialIndexRuntimeOwner\(\)\.buildSecondarySpatialIndexes",
                re.S,
            ),
        )
        self.assertRegex(
            refresh_runtime_content,
            re.compile(
                r"function refreshMapDataForScenarioChunkPromotion\([\s\S]*?"
                r"resolveScenarioChunkPromotionChangeSet\(\{[\s\S]*?"
                r"effectiveChangedLayerKeys",
                re.S,
            ),
        )
        self.assertRegex(
            promotion_helpers_content,
            re.compile(
                r'const hasAtlantropaLayerChange = normalizedChangedLayerKeys\.includes\("scenario_atlantropa"\);[\s\S]*?'
                r'"water"',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
