from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_JS = REPO_ROOT / "js" / "main.js"
STARTUP_SCENARIO_BOOT_JS = REPO_ROOT / "js" / "bootstrap" / "startup_scenario_boot.js"


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
        self.assertIn('scenarioBundleSource !== "startup-bundle"', owner_content)
        self.assertIn("defaultScenarioBundle = await loadScenarioBundle(String(defaultScenarioBundle.manifest?.scenario_id || \"\"), {", owner_content)
        self.assertIn('scenarioBundleSource = "legacy-bootstrap-recovery";', owner_content)
        self.assertIn("warnOnStartupBundleIntegrity?.(defaultScenarioBundle, {", owner_content)
        self.assertIn('finishBootMetric?.("scenario-apply", {', owner_content)
        self.assertIn("state.scenarioApplyInFlight = true;", owner_content)
        self.assertIn("state.scenarioApplyInFlight = false;", owner_content)

    def test_main_keeps_bootstrap_entry_and_ready_state_facade(self):
        donor_content = MAIN_JS.read_text(encoding="utf-8")

        self.assertIn("function getStartupScenarioBootOwner()", donor_content)
        self.assertIn("const startupScenarioBoot = getStartupScenarioBootOwner();", donor_content)
        self.assertIn("startupScenarioBoot.runStartupScenarioBoot({", donor_content)
        self.assertIn("renderDispatcher.flush();", donor_content)
        self.assertIn("await finalizeReadyState(renderDispatcher);", donor_content)
        self.assertIsNone(re.search(r"await applyScenarioBundleCommand\s*\(", donor_content))
        self.assertIsNone(re.search(r"defaultScenarioBundle\s*=\s*await loadScenarioBundle\s*\(", donor_content))


if __name__ == "__main__":
    unittest.main()
