from pathlib import Path
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
        self.assertIn('resolveSelectedOwnershipSummary()', owner_content)
        self.assertIn('devQuickSelectionValue.textContent = localizeSelectionSummary(selectionCount);', owner_content)
        self.assertIn('devQuickOwnerValue.textContent = ownerValue;', owner_content)
        self.assertIn('const devQuickRemoveSelectedBtn = quickbar.querySelector("#devQuickRemoveSelectedBtn");', owner_content)
        self.assertIn('const devSelectionToggleSelectedBtn = panel.querySelector("#devSelectionToggleSelectedBtn");', owner_content)
        self.assertIn('bindButtonAction(devQuickRemoveSelectedBtn, () => {', owner_content)
        self.assertIn('devSelectionToggleSelectedBtn.click();', owner_content)
        for retired_path in [
            "applyOwnerToFeatureIds",
            "resetOwnersToScenarioBaselineForFeatureIds",
            "buildScenarioOwnershipSavePayload",
            "postDevScenarioMutation",
            "devQuickOwnerInput",
            "devQuickUseTagBtn",
        ]:
            self.assertNotIn(retired_path, owner_content)
        for retired_dom_id in [
            "devScenarioOwnershipPanel",
            "devScenarioApplyOwnerBtn",
            "devScenarioResetOwnerBtn",
            "devScenarioSaveOwnersBtn",
        ]:
            self.assertNotIn(retired_dom_id, donor_content)

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

    def test_selection_ownership_controller_has_no_owner_mutation_or_save_path(self):
        owner_content = SELECTION_OWNERSHIP_CONTROLLER_JS.read_text(encoding="utf-8")

        for retired_path in [
            "scenario_ownership_editor.js",
            "applyOwnerToFeatureIds",
            "resetOwnersToScenarioBaselineForFeatureIds",
            "buildScenarioOwnershipSavePayload",
            "postDevScenarioMutation",
            "/__dev/scenario/ownership/save",
            "devScenarioEditor",
        ]:
            self.assertNotIn(retired_path, owner_content)

    def test_quickbar_remove_selected_reuses_selection_clipboard_toggle(self):
        owner_content = SELECTION_OWNERSHIP_CONTROLLER_JS.read_text(encoding="utf-8")

        self.assertIn('const devQuickRemoveSelectedBtn = quickbar.querySelector("#devQuickRemoveSelectedBtn");', owner_content)
        self.assertIn('const devSelectionToggleSelectedBtn = panel.querySelector("#devSelectionToggleSelectedBtn");', owner_content)
        self.assertIn('const resolveSelectedSelectionId = () => {', owner_content)
        self.assertIn("const selectedFeature = selectedId ? runtimeState.landIndex?.get(selectedId) : null;", owner_content)
        self.assertIn('runtimeState.devSelectionFeatureIds.has(selectedId)', owner_content)
        self.assertIn('devQuickRemoveSelectedBtn.disabled = !hasActiveScenario || !resolveSelectedSelectionId() || !devSelectionToggleSelectedBtn;', owner_content)
        self.assertIn('bindButtonAction(devQuickRemoveSelectedBtn, () => {', owner_content)
        self.assertIn('devSelectionToggleSelectedBtn.click();', owner_content)


if __name__ == "__main__":
    unittest.main()
