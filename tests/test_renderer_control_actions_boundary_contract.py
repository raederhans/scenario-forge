from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
PHASE_ACTIONS_JS = REPO_ROOT / "js" / "core" / "state" / "actions" / "renderer_phase_actions.js"
INTERACTION_ACTIONS_JS = REPO_ROOT / "js" / "core" / "state" / "actions" / "renderer_interaction_actions.js"
RUNTIME_STATE_JS = REPO_ROOT / "js" / "core" / "state" / "renderer_runtime_state.js"
PUBLIC_FACADE_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "public.js"


PHASE_KEYS = {
    "renderPhaseTimerId",
    "renderPhase",
    "phaseEnteredAt",
    "isInteracting",
    "pendingDayNightRefresh",
    "adaptiveSettleProfile",
    "dprStage",
    "dprLastStageSwitchAt",
}

INTERACTION_KEYS = {
    "zoomTransform",
    "lastMouseMoveTime",
    "tooltipPendingState",
    "tooltipRafHandle",
    "zoomGestureStartTransform",
    "zoomGestureScaleDelta",
    "pendingZoomTransform",
    "zoomRenderScheduled",
    "zoomGestureEndedAt",
    "activeInteractionRecoveryTaskKey",
    "activeInteractionRecoveryTaskStartedAt",
    "interactionInfrastructureStage",
    "interactionInfrastructureReady",
    "interactionInfrastructureBuildInFlight",
}

CLICK_INTERACTION_KEYS = {
    "hoveredId",
    "hoverOverlayDirty",
    "waterRegionOverrides",
}

# These action setters coexist with policy-tracked renderer writes; they are
# not yet an exclusive action boundary like the keys above.
SHARED_HIT_CANVAS_KEYS = {"hitCanvasDirty", "hitCanvasBuildScheduled"}


def assigned_keys(source):
    return set(re.findall(r"target\.([A-Za-z_$][\w$]*)\s*=", source))


class RendererControlActionsBoundaryContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = MAP_RENDERER_JS.read_text(encoding="utf-8")
        cls.phase_actions = PHASE_ACTIONS_JS.read_text(encoding="utf-8")
        cls.interaction_actions = INTERACTION_ACTIONS_JS.read_text(encoding="utf-8")

    def test_action_modules_own_exact_approved_keys(self):
        self.assertEqual(assigned_keys(self.phase_actions), PHASE_KEYS)
        self.assertEqual(
            assigned_keys(self.interaction_actions),
            INTERACTION_KEYS | CLICK_INTERACTION_KEYS | SHARED_HIT_CANVAS_KEYS,
        )

    def test_action_modules_remain_import_free_state_only_surfaces(self):
        self.assertNotRegex(self.phase_actions, r"^\s*import\s", re.MULTILINE)
        self.assertIn(
            'import { setSelectedColorState } from "./appearance_selection_actions.js";',
            self.interaction_actions,
        )
        for source in [self.phase_actions, self.interaction_actions]:
            for token in ["runtimeState", "globalThis", "document", "window", "Date.now", "requestAnimationFrame"]:
                self.assertNotIn(token, source)
        self.assertIn(
            "return setSelectedColorState(target, color);",
            self.interaction_actions,
        )

    def test_map_renderer_delegates_all_approved_writes(self):
        for import_path in [
            "./state/actions/renderer_phase_actions.js",
            "./state/actions/renderer_interaction_actions.js",
        ]:
            self.assertIn(import_path, self.renderer)
        renderer_owned_interaction_keys = INTERACTION_KEYS - {
            "interactionInfrastructureStage",
            "interactionInfrastructureReady",
            "interactionInfrastructureBuildInFlight",
        }
        for key in PHASE_KEYS | renderer_owned_interaction_keys:
            self.assertNotRegex(self.renderer, rf"\bruntimeState\.{re.escape(key)}\s*=(?!=)")
        runtime_state = RUNTIME_STATE_JS.read_text(encoding="utf-8")
        for key in INTERACTION_KEYS - renderer_owned_interaction_keys:
            self.assertNotRegex(runtime_state, rf"\btarget\.{re.escape(key)}\s*=(?!=)")
        self.assertIn("setInteractionInfrastructureActionStateFields(target, stage, options)", runtime_state)

    def test_public_boundary_remains_private(self):
        public_facade = PUBLIC_FACADE_JS.read_text(encoding="utf-8")
        for token in ["renderer_phase_actions", "renderer_interaction_actions"]:
            self.assertNotIn(token, public_facade)


if __name__ == "__main__":
    unittest.main()
