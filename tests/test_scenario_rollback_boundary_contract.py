from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ROLLBACK = REPO_ROOT / "js" / "core" / "scenario_rollback.js"


class ScenarioRollbackBoundaryContractTest(unittest.TestCase):
    def test_scenario_rollback_owns_snapshot_without_recovery_layer_dependency(self):
        content = SCENARIO_ROLLBACK.read_text(encoding="utf-8")

        self.assertIn("export function captureScenarioApplyRollbackSnapshot()", content)
        self.assertIn("export function restoreScenarioApplyRollbackSnapshot(", content)
        self.assertIn("const ROLLBACK_REQUIRED_KEYS = Object.freeze([", content)
        self.assertIn("Invalid rollback snapshot: missing required keys:", content)
        self.assertNotIn('from "./scenario_recovery.js"', content)
        self.assertNotIn("setMapData(", content)
        self.assertNotIn("rebuildPresetState(", content)
        self.assertNotIn("refreshScenarioShellOverlays(", content)
        self.assertNotIn("refreshScenarioOpeningOwnerBorders(", content)
        self.assertNotIn("refreshScenarioDataHealth(", content)
        self.assertNotIn("syncCountryUi(", content)


if __name__ == "__main__":
    unittest.main()
