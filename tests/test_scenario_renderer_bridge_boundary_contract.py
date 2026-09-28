from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_JS = REPO_ROOT / "js" / "core" / "scenario" / "scenario_renderer_bridge.js"
REFRESH_PLANS_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_plans.js"
SCENARIO_REFRESH_RUNTIME_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "scenario_refresh_runtime.js"
SCENARIO_MANAGER_JS = REPO_ROOT / "js" / "core" / "scenario_manager.js"
SCENARIO_RESOURCES_JS = REPO_ROOT / "js" / "core" / "scenario_resources.js"
SCENARIO_POST_APPLY_EFFECTS_JS = REPO_ROOT / "js" / "core" / "scenario_post_apply_effects.js"
SCENARIO_SHELL_OVERLAY_JS = REPO_ROOT / "js" / "core" / "scenario_shell_overlay.js"
DEFERRED_DETAIL_PROMOTION_JS = REPO_ROOT / "js" / "bootstrap" / "deferred_detail_promotion.js"


class ScenarioRendererBridgeBoundaryContractTest(unittest.TestCase):
    def test_bridge_reexports_scenario_refresh_surface_from_map_renderer(self):
        content = BRIDGE_JS.read_text(encoding="utf-8")
        refresh_plan_content = REFRESH_PLANS_JS.read_text(encoding="utf-8")

        self.assertIn('} from "../map_renderer.js";', content)
        self.assertIn('} from "../map_renderer/scenario_refresh_plans.js";', content)
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
        self.assertIn("createScenarioApplyRefreshPlan,", content)
        self.assertIn("createScenarioChunkPromotionRefreshPlan,", content)
        self.assertIn("createStartupHydrationRefreshPlan,", content)
        self.assertIn("getRendererRefreshPlan,", content)
        self.assertIn("function createScenarioApplyRefreshPlan(", refresh_plan_content)
        self.assertIn("function createScenarioChunkPromotionRefreshPlan(", refresh_plan_content)
        self.assertIn("function createStartupHydrationRefreshPlan(", refresh_plan_content)
        self.assertIn('kind: "ScenarioRefreshPlan"', refresh_plan_content)
        self.assertIn('kind: "RendererRefreshPlan"', refresh_plan_content)

    def test_refresh_plan_owner_stays_pure_and_renderer_consumes_it(self):
        bridge_content = BRIDGE_JS.read_text(encoding="utf-8")
        refresh_plan_content = REFRESH_PLANS_JS.read_text(encoding="utf-8")
        refresh_runtime_content = SCENARIO_REFRESH_RUNTIME_JS.read_text(encoding="utf-8")
        renderer_content = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")

        self.assertNotIn("../map_renderer.js", refresh_plan_content)
        self.assertNotIn("runtimeState", refresh_plan_content)
        self.assertNotIn("render()", refresh_plan_content)
        self.assertRegex(
            refresh_runtime_content,
            r'import\s*\{[^}]*\bnormalizeRendererRefreshPlan\b[^}]*\bresolveScenarioChunkPromotionRendererRefreshDescriptor\b[^}]*\}\s*from\s*"\./scenario_refresh_plans\.js";',
        )
        self.assertRegex(
            refresh_runtime_content,
            r"\bresolveScenarioChunkPromotionRendererRefreshDescriptor\s*\(\{",
        )
        self.assertIn("createScenarioRefreshRuntime", renderer_content)
        self.assertIn("from \"./map_renderer/scenario_refresh_runtime.js\";", renderer_content)
        self.assertNotIn("function createScenarioApplyRefreshPlan(", bridge_content)
        self.assertNotIn("function createScenarioChunkPromotionRefreshPlan(", bridge_content)

    def test_bridge_wrappers_attach_renderer_refresh_plans(self):
        content = BRIDGE_JS.read_text(encoding="utf-8")

        self.assertRegex(
            content,
            r"function refreshMapDataForScenarioApply\(options = \{\}\) \{[\s\S]*?createScenarioApplyRefreshPlan\(\)[\s\S]*?runRendererScenarioApplyRefresh\(\{[\s\S]*?refreshPlan: getRendererRefreshPlan\(refreshPlan\),",
        )
        self.assertRegex(
            content,
            r"function refreshMapDataForScenarioChunkPromotion\(options = \{\}\) \{[\s\S]*?createScenarioChunkPromotionRefreshPlan\(\{[\s\S]*?runRendererScenarioChunkPromotionRefresh\(\{[\s\S]*?changedLayerKeys: options\.changedLayerKeys \?\? refreshPlan\.changedLayerKeys,[\s\S]*?refreshPlan: getRendererRefreshPlan\(refreshPlan\),",
        )

    def test_internal_scenario_callers_use_bridge_instead_of_full_renderer_surface(self):
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_MANAGER_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_RESOURCES_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_POST_APPLY_EFFECTS_JS.read_text(encoding="utf-8"))
        self.assertIn("./scenario/scenario_renderer_bridge.js", SCENARIO_SHELL_OVERLAY_JS.read_text(encoding="utf-8"))
        self.assertIn("../core/scenario/scenario_renderer_bridge.js", DEFERRED_DETAIL_PROMOTION_JS.read_text(encoding="utf-8"))

    def test_post_apply_prefetches_navigation_after_synchronous_refresh(self):
        renderer = (REPO_ROOT / "js" / "core" / "map_renderer.js").read_text(encoding="utf-8")
        bridge = BRIDGE_JS.read_text(encoding="utf-8")
        apply_body = SCENARIO_POST_APPLY_EFFECTS_JS.read_text(encoding="utf-8").split(
            "async function runPostScenarioApplyEffects(", 1
        )[1].split("function runPostScenarioResetEffects(", 1)[0]

        prepare_body = renderer.split("function prepareScenarioNavigation() {", 1)[1].split("\n}", 1)[0]
        self.assertLess(prepare_body.index("ensureCurrentSceneSnapshot("), prepare_body.index("getNavigationSceneOwner().prewarm()"))
        self.assertIn("prepareScenarioNavigation,", bridge)
        self.assertLess(
            apply_body.index("refreshScenarioOpeningOwnerBorders({"),
            apply_body.index("prepareScenarioNavigation();"),
        )
        self.assertLess(
            apply_body.index("prepareScenarioNavigation();"),
            apply_body.index("await ensureChunkedScenarioFirstFrameReady({"),
        )


if __name__ == "__main__":
    unittest.main()
