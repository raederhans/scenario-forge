from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
PRESENTATION_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "presentation_runtime.js"


class ScenarioPresentationRuntimeBoundaryContractTest(unittest.TestCase):
    def test_presentation_runtime_owns_shared_presentation_transaction(self):
        content = PRESENTATION_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("function createScenarioPresentationRuntime({", content)
        self.assertIn("function syncScenarioPresentationUi()", content)
        self.assertIn("function normalizeScenarioPerformanceHints(manifest)", content)
        self.assertIn("function captureScenarioDisplaySettingsBeforeActivate()", content)
        self.assertIn("function applyScenarioPerformanceHints(manifest)", content)
        self.assertIn("function restoreScenarioDisplaySettingsAfterExit()", content)
        self.assertIn("function getScenarioOceanFillOverride(manifest)", content)
        self.assertIn("function updateScenarioOceanFill(fillColor, reason)", content)
        self.assertIn("function syncScenarioOceanFillForActivation(manifest)", content)
        self.assertIn("function restoreScenarioOceanFillAfterExit()", content)
        self.assertEqual(content.count("state.updateToolbarInputsFn();"), 3)
        self.assertIn("invalidateOceanBackgroundVisualState(reason);", content)
        self.assertIn("export {", content)
        self.assertIn("createScenarioPresentationRuntime,", content)


if __name__ == "__main__":
    unittest.main()
