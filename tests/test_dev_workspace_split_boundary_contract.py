from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_MUTATION_SERVICE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "dev_mutation_service.js"
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
SCENARIO_TAG_CREATOR_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_tag_creator_controller.js"


class DevWorkspaceSplitBoundaryContractTest(unittest.TestCase):
    def test_scenario_tag_creator_controller_is_retired(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        shell_content = (REPO_ROOT / "js" / "ui" / "dev_workspace" / "dev_workspace_shell_builder.js").read_text(encoding="utf-8")

        self.assertFalse(SCENARIO_TAG_CREATOR_CONTROLLER_JS.exists())
        self.assertNotIn("scenario_tag_creator_controller.js", content)
        self.assertNotIn("createScenarioTagCreatorController", content)
        self.assertNotIn("devScenarioTagCreator", content)
        self.assertNotIn("devScenarioTagCreatorPanel", shell_content)

    def test_dev_workspace_keeps_render_facade_contract(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertNotIn("scenarioTagCreatorController", content)
        self.assertIn('registerRuntimeHook(state, "updateDevWorkspaceUIFn", renderWorkspace);', content)
        self.assertIn('registerRuntimeHook(state, "setDevWorkspaceExpandedFn", (nextValue) => {', content)
        self.assertIn("export { getScenarioGeoLocaleEntry, initDevWorkspace };", content)

    def test_dev_mutation_service_is_narrow_post_boundary(self):
        helper_content = DEV_MUTATION_SERVICE_JS.read_text(encoding="utf-8")

        self.assertIn('export async function postDevScenarioMutation(endpoint, payload)', helper_content)
        self.assertIn('const DEV_SCENARIO_MUTATION_PREFIX = "/__dev/scenario/";', helper_content)
        self.assertIn("const DEV_SCENARIO_MUTATION_ENDPOINTS = new Set([", helper_content)
        self.assertEqual(8, len(re.findall(r'"/__dev/scenario/[^"]+"', helper_content)))
        self.assertIn('method: "POST",', helper_content)
        self.assertIn('"Content-Type": "application/json"', helper_content)
        self.assertIn('body: JSON.stringify(payload)', helper_content)
        self.assertNotIn('/api/scenario-diagnostics/', helper_content)
        self.assertNotIn('/.runtime/dev/active_server.json', helper_content)
        self.assertNotIn('/__dev/startup-support/key-usage-report', helper_content)


if __name__ == "__main__":
    unittest.main()
