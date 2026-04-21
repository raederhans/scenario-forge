from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
SELECTION_OWNERSHIP_CONTROLLER_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "selection_ownership_controller.js"


class DevWorkspaceSelectionOwnershipBoundaryContractTest(unittest.TestCase):
    def test_dev_workspace_imports_selection_ownership_controller(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn('./dev_workspace/selection_ownership_controller.js', content.replace('"', "'"))
        self.assertIn("createSelectionOwnershipController", content)

    def test_selection_ownership_owner_moves_to_controller(self):
        donor_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        owner_content = SELECTION_OWNERSHIP_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createSelectionOwnershipController", owner_content)
        self.assertIn("const render = ({ hasActiveScenario }) => {", owner_content)
        self.assertIn("const bindEvents = () => {", owner_content)
        self.assertIn('bindButtonAction(applyOwnerBtn, () => {', owner_content)
        self.assertIn('bindButtonAction(resetOwnerBtn, () => {', owner_content)
        self.assertIn('bindButtonAction(saveOwnersBtn, async () => {', owner_content)
        self.assertIn('bindButtonAction(devQuickUseTagBtn, () => {', owner_content)
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioApplyOwnerBtn"\),', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioResetOwnerBtn"\),', donor_content))
        self.assertIsNone(re.search(r'bindButtonAction\(panel\.querySelector\("#devScenarioSaveOwnersBtn"\),', donor_content))

    def test_dev_workspace_keeps_selection_ownership_facade_contract(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn("selectionOwnershipController = createSelectionOwnershipController({", content)
        self.assertIn("selectionOwnershipController?.render({ hasActiveScenario });", content)
        self.assertIn("selectionOwnershipController.bindEvents();", content)
        self.assertIn('bindButtonAction(devQuickRebuildBordersBtn, () => {', content)
        self.assertIn('bindButtonAction(panel.querySelector("#devCopyNamesBtn"), () => {', content)
        self.assertIn('bindButtonAction(panel.querySelector("#devCopyNamesIdsBtn"), () => {', content)
        self.assertIn('bindButtonAction(panel.querySelector("#devCopyIdsBtn"), () => {', content)
        self.assertIn('selectionSortMode.addEventListener("change", (event) => {', content)
        self.assertIn('registerRuntimeHook(state, "updateDevWorkspaceUIFn", renderWorkspace);', content)
        self.assertIn('registerRuntimeHook(state, "setDevWorkspaceExpandedFn", (nextValue) => {', content)

    def test_selection_ownership_controller_keeps_runtime_contracts(self):
        owner_content = SELECTION_OWNERSHIP_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('applyOwnerToFeatureIds(targetIds, ownerCode, {', owner_content)
        self.assertIn('resetOwnersToScenarioBaselineForFeatureIds(resolveOwnershipTargetIds(), {', owner_content)
        self.assertIn('const payload = buildScenarioOwnershipSavePayload();', owner_content)
        self.assertIn('fetch("/__dev/scenario/ownership/save"', owner_content)
        self.assertIn('state.devScenarioEditor = {', owner_content)


if __name__ == "__main__":
    unittest.main()
