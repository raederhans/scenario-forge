from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"


class ScenarioManagerBoundaryContractTest(unittest.TestCase):
    def test_scenario_manager_no_longer_owns_panel_dom(self):
        content = SCENARIO_MANAGER.read_text(encoding="utf-8")

        self.assertNotIn('document.getElementById("scenario', content)
        self.assertIsNone(re.search(r"state\.updateScenarioUIFn\s*=(?!=)", content))
        self.assertNotIn("initScenarioManager", content)
        self.assertNotIn("recalculateScenarioOwnerControllerDiffCount,", content)
        self.assertNotIn("syncScenarioLocalizationState,", content)


if __name__ == "__main__":
    unittest.main()
