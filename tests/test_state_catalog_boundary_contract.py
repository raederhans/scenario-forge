from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_CATALOG_JS = REPO_ROOT / "js" / "core" / "state_catalog.js"
SCENARIO_UI_SYNC_JS = REPO_ROOT / "js" / "core" / "scenario_ui_sync.js"
SCENARIO_MANAGER_JS = REPO_ROOT / "js" / "core" / "scenario_manager.js"


class StateCatalogBoundaryContractTest(unittest.TestCase):
    def test_scenario_ui_sync_uses_catalog_audit_ui_factory(self):
        content = SCENARIO_UI_SYNC_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultScenarioAuditUiState", content)
        self.assertIn("state.scenarioAuditUi = createDefaultScenarioAuditUiState();", content)

    def test_scenario_manager_uses_catalog_releasable_index_factory(self):
        content = SCENARIO_MANAGER_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultScenarioReleasableIndex", content)
        self.assertIn("state.scenarioReleasableIndex = createDefaultScenarioReleasableIndex();", content)

    def test_state_catalog_keeps_catalog_default_shape(self):
        content = STATE_CATALOG_JS.read_text(encoding="utf-8")

        self.assertIn("defaultReleasableCatalog: null,", content)
        self.assertIn("releasableCatalog: null,", content)
        self.assertIn("defaultReleasablePresetOverlays: {},", content)
        self.assertIn("scenarioReleasablePresetOverlays: {},", content)
        self.assertIn("releasableBoundaryVariantByTag: {},", content)
        self.assertIn("scenarioAudit: null,", content)


if __name__ == "__main__":
    unittest.main()
