from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_LIFECYCLE_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "lifecycle_runtime.js"


class ScenarioLifecycleRuntimeBoundaryContractTest(unittest.TestCase):
    def test_lifecycle_runtime_owns_reset_clear_transaction(self):
        content = SCENARIO_LIFECYCLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("function createScenarioLifecycleRuntime({", content)
        self.assertIn("function syncScenarioInspectorSelection(countryCode = \"\")", content)
        self.assertIn("function disableScenarioParentBorders()", content)
        self.assertIn("function restoreParentBordersAfterScenario()", content)
        self.assertIn("function applyScenarioPaintMode()", content)
        self.assertIn("function restorePaintModeAfterScenario()", content)
        self.assertIn("function resetToScenarioBaseline(", content)
        self.assertIn("function clearActiveScenario(", content)
        self.assertIn("recalculateScenarioOwnerControllerDiffCount,", content)
        self.assertIn("recalculateScenarioOwnerControllerDiffCount();", content)
        self.assertIn("releaseScenarioAuditPayload(previousScenarioId, { syncUi: false });", content)
        self.assertIn('resetScenarioChunkRuntimeState({ scenarioId: "" });', content)
        self.assertIn("const hasBaselineDetailTopology = !!state.topologyDetail?.objects?.political;", content)
        self.assertIn('state.topologyBundleMode = hasBaselineDetailTopology ? "composite" : "single";', content)
        self.assertIn("state.detailDeferred = hasBaselineRuntimeTopology && !hasBaselineDetailTopology;", content)
        self.assertIn("state.detailPromotionCompleted = hasBaselineDetailTopology;", content)
        self.assertIn("restoreScenarioOceanFillAfterExit();", content)
        self.assertIn("restoreScenarioDisplaySettingsAfterExit();", content)
        self.assertIn("state.scenarioReleasableIndex = createDefaultScenarioReleasableIndex();", content)
        self.assertIn("state.scenarioHydrationHealthGate = createDefaultScenarioHydrationHealthGate();", content)
        self.assertIn("state.scenarioDataHealth = createDefaultScenarioDataHealth(", content)
        self.assertIn("runPostScenarioResetEffects({", content)
        self.assertIn("runPostScenarioClearEffects({ renderNow });", content)
        self.assertIn("return {", content)
        self.assertIn("clearActiveScenario,", content)
        self.assertIn("resetToScenarioBaseline,", content)
        self.assertNotIn("restorePaintModeAfterScenario,", content)
        self.assertNotIn("restoreParentBordersAfterScenario,", content)
        self.assertIn("export {", content)
        self.assertIn("createScenarioLifecycleRuntime,", content)

    def test_lifecycle_runtime_stays_internal_and_one_way(self):
        content = SCENARIO_LIFECYCLE_RUNTIME.read_text(encoding="utf-8")

        self.assertIsNone(re.search(r"from\\s+\"\\.\\./scenario_manager\\.js\"", content))
        self.assertIsNone(re.search(r"from\\s+\"\\.\\./scenario_apply_pipeline\\.js\"", content))
        self.assertNotIn("captureScenarioApplyRollbackSnapshot", content)
        self.assertNotIn("activeScenarioApplyPromise", content)
        self.assertNotIn("applyScenarioById(", content)


if __name__ == "__main__":
    unittest.main()
