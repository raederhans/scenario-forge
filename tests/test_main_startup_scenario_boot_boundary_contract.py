from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_SCENARIO_BOOT_JS = REPO_ROOT / "js" / "bootstrap" / "startup_scenario_boot.js"
STARTUP_READY_HANDOFF_JS = REPO_ROOT / "js" / "bootstrap" / "startup_ready_handoff.js"
DEFERRED_DETAIL_PROMOTION_JS = REPO_ROOT / "js" / "bootstrap" / "deferred_detail_promotion.js"
MAIN_RUNTIME_DIAGNOSTICS_JS = REPO_ROOT / "js" / "bootstrap" / "main_runtime_diagnostics.js"


class MainStartupScenarioBootBoundaryContractTest(unittest.TestCase):
    def test_owner_file_exists_and_exports_factory(self):
        owner_content = STARTUP_SCENARIO_BOOT_JS.read_text(encoding="utf-8")

        self.assertIn('from "../core/scenario_resources.js"', owner_content)
        self.assertIn('from "../core/scenario_dispatcher.js"', owner_content)
        self.assertIn("export function createStartupScenarioBootOwner({", owner_content)
        self.assertIn("async function runStartupScenarioBoot({", owner_content)

    def test_owner_keeps_startup_bundle_apply_and_recovery_transaction(self):
        owner_content = STARTUP_SCENARIO_BOOT_JS.read_text(encoding="utf-8")

        self.assertIn('setBootState?.("scenario-bundle");', owner_content)
        self.assertIn('finishBootMetric?.("scenario-bundle", {', owner_content)
        self.assertIn('setBootState?.("scenario-apply");', owner_content)
        self.assertIn('startBootMetric?.("scenario-apply");', owner_content)
        self.assertIn("await applyScenarioBundleCommand(defaultScenarioBundle, {", owner_content)
        self.assertIn('import { normalizeScenarioId } from "../core/scenario/shared.js";', owner_content)
        self.assertIn("function cacheStartupScenarioBundle(runtimeState, bundle)", owner_content)
        self.assertIn("const scenarioId = normalizeScenarioId(bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id);", owner_content)
        self.assertRegex(
            owner_content,
            r'if \(!defaultScenarioBundle\?\.manifest\) \{[\s\S]*?\}\s*cacheStartupScenarioBundle\(runtimeState, defaultScenarioBundle\);\s*finishBootMetric\?\.\("scenario-bundle"',
        )
        self.assertIn('scenarioBundleSource === "startup-bundle"', owner_content)
        self.assertIn("defaultScenarioBundle?.loadDiagnostics?.startupBundle === true", owner_content)
        self.assertIn("deferChunkPrewarm: canDeferStartupChunkPrewarm,", owner_content)
        self.assertIn("canDeferStartupChunkPrewarm = false;", owner_content)
        recovery_apply = re.search(
            r'scenarioBundleSource = "legacy-bootstrap-recovery";(?P<body>[\s\S]*?)\n      \}\);',
            owner_content,
        )
        self.assertIsNotNone(recovery_apply)
        self.assertNotIn("deferChunkPrewarm", recovery_apply.group("body"))
        self.assertIn('scenarioBundleSource !== "startup-bundle"', owner_content)
        self.assertIn("defaultScenarioBundle = await loadScenarioBundle(String(defaultScenarioBundle.manifest?.scenario_id || \"\"), {", owner_content)
        self.assertIn('scenarioBundleSource = "legacy-bootstrap-recovery";', owner_content)
        self.assertIn("cacheStartupScenarioBundle(runtimeState, defaultScenarioBundle);", owner_content)
        self.assertIn("warnOnStartupBundleIntegrity?.(defaultScenarioBundle, {", owner_content)
        self.assertIn('finishBootMetric?.("scenario-apply", {', owner_content)
        self.assertIn("runtimeState.scenarioApplyInFlight = true;", owner_content)
        self.assertIn("runtimeState.scenarioApplyInFlight = false;", owner_content)

    def test_startup_apply_keeps_detail_health_and_toasts_deferred(self):
        owner_content = STARTUP_SCENARIO_BOOT_JS.read_text(encoding="utf-8")
        deferred_content = DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8")

        self.assertEqual(owner_content.count("showToastOnComplete: false,"), 2)
        self.assertNotIn("refreshScenarioDataHealth", owner_content)
        self.assertIn("function syncScenarioReadyUiAfterDetailPromotion()", deferred_content)
        self.assertIn("showWarningToast: false,", deferred_content)
        self.assertIn("showErrorToast: false,", deferred_content)
        self.assertLess(
            deferred_content.index("runtimeState.detailPromotionCompleted = true;"),
            deferred_content.index("syncScenarioReadyUiAfterDetailPromotion();"),
        )

    def test_main_keeps_bootstrap_entry_and_ready_state_facade(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("function getStartupScenarioBootOwner()", donor_content)
        self.assertIn("runtimeState: state,", donor_content)
        self.assertIn('registerRuntimeHook(state, "noteFirstVisibleFramePaintedFn", checkpointFirstVisibleFrameMetrics);', donor_content)
        self.assertIn("function checkpointFirstVisibleFrameMetrics()", donor_content)
        self.assertIn("function assertStartupFirstVisibleFrameAccepted(", donor_content)
        self.assertRegex(
            donor_content,
            r"function checkpointFirstVisibleFrameMetrics\(\) \{[\s\S]*?if \(!state\.firstVisibleFramePainted\) \{[\s\S]*?return null;[\s\S]*?checkpointBootMetricOnce\(\"first-visible\"\);[\s\S]*?checkpointBootMetricOnce\(\"first-visible-scenario\"\);",
        )
        self.assertRegex(
            donor_content,
            r"function assertStartupFirstVisibleFrameAccepted\([\s\S]*?const metrics = checkpointFirstVisibleFrameMetrics\(\);[\s\S]*?if \(metrics\) return metrics;[\s\S]*?firstVisibleFrameBlocked[\s\S]*?throw new Error",
        )
        self.assertIn("const startupScenarioBoot = await getStartupScenarioBootOwner();", donor_content)
        self.assertIn("startupScenarioBoot.runStartupScenarioBoot({", donor_content)
        self.assertIn('invalidateAllRenderPasses("bootstrap-first-political-frame");', donor_content)
        self.assertLess(
            donor_content.index('invalidateAllRenderPasses("bootstrap-first-political-frame");'),
            donor_content.index("void observeUiHydration();"),
        )
        self.assertIn("renderDispatcher.flush();", donor_content)
        self.assertIn("await finalizeReadyState(renderDispatcher);", donor_content)
        self.assertRegex(
            donor_content,
            r"setBootState\(\"warmup\"\);\s*invalidateAllRenderPasses\(\"bootstrap-first-political-frame\"\);\s*await waitForStartupRenderSettle\(runtimeState\);\s*renderDispatcher\.flush\(\);\s*assertStartupFirstVisibleFrameAccepted\(\"bootstrap-first-political-frame\"\);",
        )
        self.assertIsNone(re.search(r"await applyScenarioBundleCommand\s*\(", donor_content))
        self.assertIsNone(re.search(r"defaultScenarioBundle\s*=\s*await loadScenarioBundle\s*\(", donor_content))

    def test_main_keeps_deferred_physical_atlas_and_contour_pending_paths(self):
        owner_content = STARTUP_READY_HANDOFF_JS.read_text(encoding="utf-8")
        diagnostics_content = MAIN_RUNTIME_DIAGNOSTICS_JS.read_text(encoding="utf-8")

        self.assertIn("function schedulePostReadyDeferredContextWarmup()", owner_content)
        self.assertIn("requestedLayerNames.push(\"physical-set\");", owner_content)
        self.assertIn("requestedContourLayerNames.push(\"physical-contours-set\");", owner_content)
        self.assertIn("postReadyScheduler.scheduleTask(\"post-ready-context-warmup\"", owner_content)
        self.assertIn("postReadyScheduler.scheduleTask(\"post-ready-contour-warmup\"", owner_content)
        self.assertIn("ensureContextLayerDataReady(requestedContourLayerNames, {", owner_content)
        self.assertIn('reason: "post-ready-contours"', owner_content)
        self.assertIn("postReadyScheduler: cloneSnapshotValue(state.postReadyTaskDiagnostics, {})", diagnostics_content)


if __name__ == "__main__":
    unittest.main()
