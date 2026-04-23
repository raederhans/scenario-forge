from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
PRESENTATION_RUNTIME = REPO_ROOT / "js" / "core" / "scenario" / "presentation_runtime.js"
PRESENTATION_HINT_HELPERS = REPO_ROOT / "js" / "core" / "scenario" / "presentation_hint_helpers.js"
PRESENTATION_DISPLAY_RESTORE = REPO_ROOT / "js" / "core" / "scenario" / "presentation_display_restore.js"
PRESENTATION_OCEAN_FILL_RESTORE = REPO_ROOT / "js" / "core" / "scenario" / "presentation_ocean_fill_restore.js"


class ScenarioPresentationRuntimeBoundaryContractTest(unittest.TestCase):
    def test_presentation_runtime_owns_shared_presentation_transaction(self):
        runtime_content = PRESENTATION_RUNTIME.read_text(encoding="utf-8")
        hint_content = PRESENTATION_HINT_HELPERS.read_text(encoding="utf-8")
        display_content = PRESENTATION_DISPLAY_RESTORE.read_text(encoding="utf-8")
        ocean_fill_content = PRESENTATION_OCEAN_FILL_RESTORE.read_text(encoding="utf-8")

        self.assertIn("function createScenarioPresentationRuntime({", runtime_content)
        self.assertIn("createScenarioDisplayRestoreRuntime", runtime_content)
        self.assertIn("createScenarioOceanFillRestoreRuntime", runtime_content)
        self.assertIn("normalizeScenarioPerformanceHints,", runtime_content)
        self.assertIn("function normalizeScenarioPerformanceHints(manifest)", hint_content)
        self.assertIn("function syncScenarioPresentationUi()", display_content)
        self.assertIn("function captureScenarioDisplaySettingsBeforeActivate()", display_content)
        self.assertIn("function applyScenarioPerformanceHints(manifest)", display_content)
        self.assertIn("function restoreScenarioDisplaySettingsAfterExit()", display_content)
        self.assertIn("function getScenarioOceanFillOverride(manifest)", ocean_fill_content)
        self.assertIn("function updateScenarioOceanFill(fillColor, reason)", ocean_fill_content)
        self.assertIn("function syncScenarioOceanFillForActivation(manifest)", ocean_fill_content)
        self.assertIn("function restoreScenarioOceanFillAfterExit()", ocean_fill_content)
        self.assertEqual(display_content.count("emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);"), 1)
        self.assertEqual(ocean_fill_content.count("emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);"), 1)
        self.assertIn("invalidateOceanBackgroundVisualState(reason);", ocean_fill_content)
        self.assertIn("export {", runtime_content)
        self.assertIn("createScenarioPresentationRuntime,", runtime_content)


if __name__ == "__main__":
    unittest.main()
