from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
DISTRICT_EDITOR_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "district_editor_controller.js"


class DevWorkspaceDistrictEditorBoundaryContractTest(unittest.TestCase):
    def test_dev_workspace_imports_district_editor_controller(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn('./dev_workspace/district_editor_controller.js', content.replace('"', "'"))
        self.assertIn("createDistrictEditorController", content)

    def test_district_editor_owner_moves_to_controller(self):
        donor_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        owner_content = DISTRICT_EDITOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDistrictEditorController", owner_content)
        self.assertIn("const resolveDistrictEditorModel = () => {", owner_content)
        self.assertIn("const render = ({ hasActiveScenario }) => {", owner_content)
        self.assertIn("const bindEvents = () => {", owner_content)
        self.assertIn('bindButtonAction(districtSaveBtn, async () => {', owner_content)
        self.assertIn('bindButtonAction(scenarioDistrictPromoteBtn, async () => {', owner_content)
        self.assertIn('bindButtonAction(scenarioDistrictApplyTemplateBtn, async () => {', owner_content)
        self.assertIn('fetch("/__dev/scenario/districts/save"', owner_content)
        self.assertIn('fetch("/__dev/scenario/district-templates/save"', owner_content)
        self.assertIn('fetch("/__dev/scenario/district-templates/apply"', owner_content)

        self.assertIsNone(re.search(r"function\s+resolveDistrictEditorModel\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+buildDistrictSavePayload\s*\(", donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioDistrictSaveBtn"\),', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(scenarioDistrictPromoteBtn,\s*async\s*\(\)\s*=>', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(scenarioDistrictApplyTemplateBtn,\s*async\s*\(\)\s*=>', donor_content))

    def test_dev_workspace_keeps_district_facade_contract(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn("districtEditorController = createDistrictEditorController({", content)
        self.assertIn("districtEditorController?.render({ hasActiveScenario });", content)
        self.assertIn("districtEditorController.bindEvents();", content)
        self.assertIn('const scenarioDistrictPanel = panel.querySelector("#devScenarioDistrictPanel");', content)
        self.assertIn('syncCategoryPanel(scenarioDistrictPanel, "scenario", hasActiveScenario);', content)
        self.assertIn('registerRuntimeHook(state, "updateDevWorkspaceUIFn", renderWorkspace);', content)
        self.assertIn('registerRuntimeHook(state, "setDevWorkspaceExpandedFn", (nextValue) => {', content)

    def test_district_editor_controller_keeps_runtime_contracts(self):
        owner_content = DISTRICT_EDITOR_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("runtimeState.devScenarioDistrictEditor = {", owner_content)
        self.assertIn("runtimeState.scenarioDistrictGroupsData = nextPayload;", owner_content)
        self.assertIn("runtimeState.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(nextPayload);", owner_content)
        self.assertIn('import { rebuildStaticMeshes } from "../../core/map_renderer/public.js";', owner_content)
        self.assertIn("rebuildStaticMeshes();", owner_content)
        self.assertIn('flushDevWorkspaceRender("dev-workspace-district-save");', owner_content)
        self.assertIn("district_groups_url: String(result.districtGroupsUrl", owner_content)


if __name__ == "__main__":
    unittest.main()

