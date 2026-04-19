from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
DEV_WORKSPACE_JS = REPO_ROOT / "js" / "ui" / "dev_workspace.js"
DEV_WORKSPACE_SHELL_BUILDER_JS = REPO_ROOT / "js" / "ui" / "dev_workspace" / "dev_workspace_shell_builder.js"


class DevWorkspaceShellBuilderBoundaryContractTest(unittest.TestCase):
    def test_dev_workspace_imports_shell_builder(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn('./dev_workspace/dev_workspace_shell_builder.js', content.replace('"', "'"))
        self.assertIn("createDevWorkspacePanel", content)
        self.assertIn("createDevWorkspaceQuickbar", content)
        self.assertIn("applyDevWorkspaceExpandedChrome", content)

    def test_shell_builder_owns_panel_quickbar_and_dock_chrome(self):
        donor_content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")
        owner_content = DEV_WORKSPACE_SHELL_BUILDER_JS.read_text(encoding="utf-8")

        self.assertIn("export function createDevWorkspacePanel", owner_content)
        self.assertIn("export function createDevWorkspaceQuickbar", owner_content)
        self.assertIn("export function applyDevWorkspaceExpandedChrome", owner_content)
        self.assertIn('section.id = "devWorkspacePanel";', owner_content)
        self.assertIn('quickbar.id = "devWorkspaceQuickbar";', owner_content)
        self.assertIn('toggleBtn.textContent = ui("Dev");', owner_content)
        self.assertIn('dockCollapseBtn.setAttribute("aria-label", t("Collapse quick dock", "ui"));', owner_content)

        self.assertIsNone(re.search(r"function\s+createDevWorkspacePanel\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+createDevWorkspaceQuickbar\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+updateToggleButton\s*\(", donor_content))
        self.assertIsNone(re.search(r"function\s+syncDockState\s*\(", donor_content))

    def test_dev_workspace_keeps_host_facade_contract(self):
        content = DEV_WORKSPACE_JS.read_text(encoding="utf-8")

        self.assertIn("const quickbar = createDevWorkspaceQuickbar(bottomDock);", content)
        self.assertIn("const panel = createDevWorkspacePanel(bottomDock);", content)
        self.assertIn("applyDevWorkspaceExpandedChrome({", content)
        self.assertIn("state.updateDevWorkspaceUIFn = renderWorkspace;", content)
        self.assertIn("state.setDevWorkspaceExpandedFn = (nextValue) => {", content)
        self.assertIn("export { getScenarioGeoLocaleEntry, initDevWorkspace };", content)

    def test_shell_builder_preserves_dom_surface_contracts(self):
        owner_content = DEV_WORKSPACE_SHELL_BUILDER_JS.read_text(encoding="utf-8")

        self.assertIn('id="devScenarioOwnershipPanel"', owner_content)
        self.assertIn('id="devScenarioTagCreatorPanel"', owner_content)
        self.assertIn('id="devScenarioDistrictPanel"', owner_content)
        self.assertIn('quickbar.id = "devWorkspaceQuickbar";', owner_content)
        self.assertIn('id="devQuickRebuildBordersBtn"', owner_content)
        self.assertIn('applyDeclarativeTranslations(section);', owner_content)
        self.assertIn('applyDeclarativeTranslations(quickbar);', owner_content)


if __name__ == "__main__":
    unittest.main()
