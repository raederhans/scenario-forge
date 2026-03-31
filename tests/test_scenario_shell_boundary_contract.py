from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIO_MANAGER = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_RESOURCES = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_SHELL_OVERLAY = REPO_ROOT / "js" / "core" / "scenario_shell_overlay.js"


class ScenarioShellBoundaryContractTest(unittest.TestCase):
    def test_shell_overlay_is_only_owner_of_shell_derivation(self):
        manager = SCENARIO_MANAGER.read_text(encoding="utf-8")
        resources = SCENARIO_RESOURCES.read_text(encoding="utf-8")
        shell_overlay = SCENARIO_SHELL_OVERLAY.read_text(encoding="utf-8")

        for content in (manager, resources):
            self.assertIsNone(re.search(r"^function\s+isScenarioShellCandidate\b", content, re.MULTILINE))
            self.assertIsNone(re.search(r"^function\s+getScenarioRuntimeNeighborGraph\b", content, re.MULTILINE))
            self.assertIsNone(re.search(r"^function\s+buildScenarioCanonicalFallbackMaps\b", content, re.MULTILINE))
            self.assertIsNone(re.search(r"^function\s+pickScenarioMajorityCode\b", content, re.MULTILINE))

        self.assertIn("export function refreshScenarioShellOverlays(", shell_overlay)
        self.assertIn("function getScenarioRuntimeNeighborGraph(", shell_overlay)
        self.assertIn("function buildScenarioCanonicalFallbackMaps(", shell_overlay)


if __name__ == "__main__":
    unittest.main()
