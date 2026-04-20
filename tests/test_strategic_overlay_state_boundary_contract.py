from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_JS = REPO_ROOT / "js" / "core" / "state.js"
INTERACTION_FUNNEL_JS = REPO_ROOT / "js" / "core" / "interaction_funnel.js"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
STRATEGIC_OVERLAY_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "strategic_overlay_state.js"


class StrategicOverlayStateBoundaryContractTest(unittest.TestCase):
    def test_overlay_defaults_live_in_single_owner(self):
        owner_content = STRATEGIC_OVERLAY_STATE_JS.read_text(encoding="utf-8")

        self.assertIn("createDefaultSpecialZoneEditorState", owner_content)
        self.assertIn("createDefaultOperationGraphicsEditorState", owner_content)
        self.assertIn("createDefaultUnitCounterEditorState", owner_content)
        self.assertIn("createDefaultOperationalLineEditorState", owner_content)
        self.assertIn("createDefaultStrategicOverlayUiState", owner_content)
        self.assertIn("presetId = \"inf\"", owner_content)
        self.assertIn("returnSelectionId: null,", owner_content)

    def test_state_and_runtime_consumers_reuse_owner_factories(self):
        state_content = STATE_JS.read_text(encoding="utf-8")
        funnel_content = INTERACTION_FUNNEL_JS.read_text(encoding="utf-8")
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

        self.assertIn('./state/strategic_overlay_state.js', state_content)
        self.assertIn('./state/strategic_overlay_state.js', funnel_content)
        self.assertIn('./state/strategic_overlay_state.js', renderer_content)
        self.assertIn("...createDefaultStrategicOverlayState(),", state_content)
        self.assertIn("state.specialZoneEditor = createDefaultSpecialZoneEditorState();", funnel_content)
        self.assertIn("state.operationGraphicsEditor = createDefaultOperationGraphicsEditorState();", funnel_content)
        self.assertIn("state.operationalLineEditor = createDefaultOperationalLineEditorState();", funnel_content)
        self.assertIn("state.unitCounterEditor = createDefaultUnitCounterEditorState({", funnel_content)
        self.assertIn("state.strategicOverlayUi = createDefaultStrategicOverlayUiState();", funnel_content)
        self.assertIn("state.specialZoneEditor = createDefaultSpecialZoneEditorState();", renderer_content)
        self.assertIn("state.operationGraphicsEditor = createDefaultOperationGraphicsEditorState();", renderer_content)
        self.assertIn("state.operationalLineEditor = createDefaultOperationalLineEditorState();", renderer_content)
        self.assertIn("state.unitCounterEditor = createDefaultUnitCounterEditorState({", renderer_content)


if __name__ == "__main__":
    unittest.main()
