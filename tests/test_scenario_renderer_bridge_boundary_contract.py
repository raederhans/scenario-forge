from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_JS = REPO_ROOT / "js" / "core" / "scenario" / "scenario_renderer_bridge.js"
SCENARIO_MANAGER_JS = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_RESOURCES_JS = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_POST_APPLY_EFFECTS_JS = REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
SCENARIO_SHELL_OVERLAY_JS = REPO_ROOT / "js" / "core" / "scenario_shell_overlay.js"
DEFERRED_DETAIL_PROMOTION_JS = REPO_ROOT / "js" / "bootstrap" / "deferred_detail_promotion.js"


class ScenarioRendererBridgeBoundaryContractTest(unittest.TestCase):
    def test_bridge_reexports_scenario_refresh_surface_from_map_renderer(self):
        content = BRIDGE_JS.read_text(encoding="utf-8")

        self.assertIn('} from "../map_renderer.js";', content)
        self.assertIn("runRendererScenarioApplyRefresh,", content)
        self.assertIn("runRendererScenarioChunkPromotionRefresh,", content)
        self.assertIn("refreshMapDataForScenarioApply,", content)
        self.assertIn("refreshMapDataForScenarioChunkPromotion,", content)
        self.assertIn("refreshScenarioOpeningOwnerBorders,", content)
        self.assertIn("refreshResolvedColorsForFeatures,", content)
        self.assertIn("refreshColorState,", content)
        self.assertIn("recomputeDynamicBordersNow,", content)
        self.assertIn("invalidateOceanBackgroundVisualState,", content)
        self.assertIn("invalidateOceanWaterInteractionVisualState,", content)
        self.assertIn("invalidateContextLayerVisualStateBatch,", content)
        self.assertIn("setMapData,", content)
        self.assertIn("function createScenarioApplyRefreshPlan(", content)
        self.assertIn("function createScenarioChunkPromotionRefreshPlan(", content)
        self.assertIn("function createStartupHydrationRefreshPlan(", content)
        self.assertIn('kind: "ScenarioRefreshPlan"', content)
        self.assertIn('kind: "RendererRefreshPlan"', content)

    def test_bridge_wrappers_attach_renderer_refresh_plans(self):
        content = BRIDGE_JS.read_text(encoding="utf-8")

        self.assertRegex(
            content,
            r"function refreshMapDataForScenarioApply\(options = \{\}\) \{[\s\S]*?createScenarioApplyRefreshPlan\(\)[\s\S]*?runRendererScenarioApplyRefresh\(\{[\s\S]*?refreshPlan: getRendererRefreshPlan\(refreshPlan\),",
        )
        self.assertRegex(
            content,
            r"function refreshMapDataForScenarioChunkPromotion\(options = \{\}\) \{[\s\S]*?createScenarioChunkPromotionRefreshPlan\(\{[\s\S]*?runRendererScenarioChunkPromotionRefresh\(\{[\s\S]*?refreshPlan: getRendererRefreshPlan\(refreshPlan\),",
        )

    def test_internal_scenario_callers_use_bridge_instead_of_full_renderer_surface(self):
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_MANAGER_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_RESOURCES_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_POST_APPLY_EFFECTS_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_SHELL_OVERLAY_JS.read_text(encoding="utf-8"))
        self.assertIn("../core/scenario/scenario_renderer_bridge.js", DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
