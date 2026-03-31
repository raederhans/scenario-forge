from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_DATA_HEALTH = REPO_ROOT / "js" / "core" / "scenario_data_health.js"


class ScenarioDataHealthBoundaryContractTest(unittest.TestCase):
    def test_data_health_has_single_owner(self):
        manager = SCENARIO_MANAGER.read_text(encoding="utf-8")
        resources = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        data_health = SCENARIO_DATA_HEALTH.read_text(encoding="utf-8")

        for content in (manager, resources):
            self.assertIsNone(re.search(r"^function\s+evaluateScenarioDataHealth\b", content, re.MULTILINE))
            self.assertIsNone(re.search(r"^function\s+scenarioNeedsDetailTopology\b", content, re.MULTILINE))
            self.assertIsNone(re.search(r"^function\s+refreshScenarioDataHealth\b", content, re.MULTILINE))

        self.assertIn("export {", data_health)
        self.assertIn("evaluateScenarioDataHealth,", data_health)
        self.assertIn("refreshScenarioDataHealth,", data_health)
        self.assertIn("scenarioNeedsDetailTopology,", data_health)
        self.assertIn("hasUsablePoliticalTopology,", data_health)


if __name__ == "__main__":
    unittest.main()
