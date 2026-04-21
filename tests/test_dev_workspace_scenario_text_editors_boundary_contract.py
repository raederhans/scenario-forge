from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
SCENARIO_TEXT_EDITORS_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "scenario_text_editors_controller.js"


class DevWorkspaceScenarioTextEditorsBoundaryContractTest(unittest.TestCase):
    def test_dev_workspace_imports_scenario_text_editors_controller(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn('./dev_workspace/scenario_text_editors_controller.js', content.replace('"', "'"))
        self.assertIn("createScenarioTextEditorsController", content)

    def test_scenario_text_editors_owner_moves_to_controller(self):
        donor_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        owner_content = SCENARIO_TEXT_EDITORS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createScenarioTextEditorsController", owner_content)
        self.assertIn("const resolveCountryEditorModel = () => {", owner_content)
        self.assertIn("const resolveCapitalEditorModel = () => {", owner_content)
        self.assertIn("const resolveLocaleEditorModel = () => {", owner_content)
        self.assertIn("const render = ({ hasActiveScenario }) => {", owner_content)
        self.assertIn("const bindEvents = () => {", owner_content)
        self.assertIn('fetch("/__dev/scenario/country/save"', owner_content)
        self.assertIn('fetch("/__dev/scenario/capital/save"', owner_content)
        self.assertIn('fetch("/__dev/scenario/geo-locale/save"', owner_content)

        self.assertIsNone(re.search(r"function\s+resolveCountryEditorModel\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+resolveCapitalEditorModel\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+resolveLocaleEditorModel\s*\(", donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioSaveCountryBtn"\),', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioSaveCapitalBtn"\),', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioSaveLocaleBtn"\),', donor_content))

    def test_dev_workspace_keeps_text_editor_facade_contract(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn("scenarioTextEditorsController = createScenarioTextEditorsController({", content)
        self.assertIn("scenarioTextEditorsController?.render({ hasActiveScenario });", content)
        self.assertIn("scenarioTextEditorsController.bindEvents();", content)
        self.assertIn('const scenarioCountryPanel = panel.querySelector("#devScenarioCountryPanel");', content)
        self.assertIn('const scenarioCapitalPanel = panel.querySelector("#devScenarioCapitalPanel");', content)
        self.assertIn('const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");', content)
        self.assertIn('syncCategoryPanel(scenarioCountryPanel, "scenario", hasActiveScenario);', content)
        self.assertIn('syncCategoryPanel(scenarioCapitalPanel, "scenario", hasActiveScenario);', content)
        self.assertIn('syncCategoryPanel(scenarioLocalePanel, "scenario", hasActiveScenario);', content)
        self.assertIn("export { getScenarioGeoLocaleEntry, initDevWorkspace };", content)
        self.assertIn('registerRuntimeHook(state, "updateDevWorkspaceUIFn", renderWorkspace);', content)

    def test_controller_keeps_country_capital_locale_runtime_contracts(self):
        owner_content = SCENARIO_TEXT_EDITORS_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('flushDevWorkspaceRender("dev-workspace-country-save");', owner_content)
        self.assertIn('flushDevWorkspaceRender("dev-workspace-capital-save");', owner_content)
        self.assertIn('flushDevWorkspaceRender("dev-workspace-locale-save");', owner_content)
        self.assertIn("syncRuntimeScenarioCityOverrides(nextOverrides);", owner_content)
        self.assertIn("syncScenarioLocalizationState({", owner_content)
        self.assertIn("getScenarioGeoLocaleEntry(featureId)", owner_content)


if __name__ == "__main__":
    unittest.main()
