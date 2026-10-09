from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CLICK_SELECTION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "click_selection_transaction_owner.js"
RENDER_PIPELINE_PASSES_JS = REPO_ROOT / "js" / "core" / "renderer" / "render_pipeline_passes.js"
RENDER_PIPELINE_CATALOG_JS = REPO_ROOT / "js" / "core" / "renderer" / "render_pipeline_catalog.js"
VISUAL_EFFECTS_PASS_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "visual_effects_pass_owner.js"
DAY_NIGHT_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "day_night_runtime_owner.js"
CONTEXT_PASS_ORCHESTRATOR_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "context_pass_orchestrator_owner.js"
POLITICAL_PASS_ORCHESTRATOR_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "political_pass_orchestrator_owner.js"
POLITICAL_BACKGROUND_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "political_background_render_owner.js"
EXACT_AFTER_SETTLE_PASS_CATALOG_JS = REPO_ROOT / "js" / "core" / "renderer" / "exact_after_settle_pass_catalog.js"
EXACT_AFTER_SETTLE_PLANS_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "exact_after_settle_refresh_plans.js"
EXACT_AFTER_SETTLE_SCHEDULER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "exact_after_settle_scheduler.js"
DRAW_CANVAS_ORCHESTRATION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "draw_canvas_orchestration_owner.js"
RENDER_PASS_COMMIT_ACCOUNTING_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "render_pass_commit_accounting_owner.js"
RENDER_PASS_CATALOG_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "render_pass_catalog.js"
VIEWPORT_READ_MODEL_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "viewport_read_model_owner.js"
VIEWPORT_COMMAND_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "viewport_command_owner.js"


class MapRendererRenderPipelinePassesBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_pass_orchestration_shell_while_idle_pass_owner_moves_to_module(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        draw_canvas_owner_content = DRAW_CANVAS_ORCHESTRATION_OWNER_JS.read_text(encoding="utf-8")
        owner_content = RENDER_PIPELINE_PASSES_JS.read_text(encoding="utf-8")
        visual_effects_owner_content = VISUAL_EFFECTS_PASS_OWNER_JS.read_text(encoding="utf-8")
        day_night_owner_content = DAY_NIGHT_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        context_pass_owner_content = CONTEXT_PASS_ORCHESTRATOR_OWNER_JS.read_text(encoding="utf-8")
        political_pass_owner_content = POLITICAL_PASS_ORCHESTRATOR_OWNER_JS.read_text(encoding="utf-8")
        political_background_owner_content = POLITICAL_BACKGROUND_RENDER_OWNER_JS.read_text(encoding="utf-8")
        pipeline_catalog_content = RENDER_PIPELINE_CATALOG_JS.read_text(encoding="utf-8")
        exact_pass_catalog_content = EXACT_AFTER_SETTLE_PASS_CATALOG_JS.read_text(encoding="utf-8")
        exact_plan_content = EXACT_AFTER_SETTLE_PLANS_JS.read_text(encoding="utf-8")
        exact_scheduler_content = EXACT_AFTER_SETTLE_SCHEDULER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        # 这个静态合同锁的是“map_renderer 只保留编排壳，idle pass 细节归 owner”。
        # 后续拆分 render pass 时应改 owner 入口，让长函数维持在 owner 内。
        self.assertIn(
            "import { createRenderPipelinePassesOwner } from './renderer/render_pipeline_passes.js';",
            renderer_imports,
        )
        self.assertIn(
            "import { createVisualEffectsPassOwner } from './renderer/visual_effects_pass_owner.js';",
            renderer_imports,
        )
        self.assertIn(
            "import { createDayNightRuntimeOwner } from './renderer/day_night_runtime_owner.js';",
            renderer_imports,
        )
        self.assertIn(
            "import { createContextPassOrchestratorOwner } from './renderer/context_pass_orchestrator_owner.js';",
            renderer_imports,
        )
        self.assertIn(
            "import { createPoliticalPassOrchestratorOwner } from './renderer/political_pass_orchestrator_owner.js';",
            renderer_imports,
        )
        self.assertIn("let renderPipelinePassesOwner = null;", renderer_content)
        self.assertIn("let visualEffectsPassOwner = null;", renderer_content)
        self.assertIn("let contextPassOrchestratorOwner = null;", renderer_content)
        self.assertIn("let politicalPassOrchestratorOwner = null;", renderer_content)
        self.assertIn("function getVisualEffectsPassOwner() {", renderer_content)
        self.assertIn("visualEffectsPassOwner = createVisualEffectsPassOwner({", renderer_content)
        self.assertIn("function getContextPassOrchestratorOwner() {", renderer_content)
        self.assertIn("contextPassOrchestratorOwner = createContextPassOrchestratorOwner({", renderer_content)
        self.assertIn("function getPoliticalPassOrchestratorOwner() {", renderer_content)
        self.assertIn("politicalPassOrchestratorOwner = createPoliticalPassOrchestratorOwner({", renderer_content)
        self.assertIn(
            "function drawPoliticalPass(k) {\n  return getPoliticalPassOrchestratorOwner().drawPoliticalPass(k);\n}",
            renderer_content,
        )
        self.assertIn(
            "function drawEffectsPass(k, options = undefined) {\n  return getVisualEffectsPassOwner().drawEffectsPass(k, options);\n}",
            renderer_content,
        )
        self.assertIn(
            "function drawLineEffectsPass(k, options = undefined) {\n  return getVisualEffectsPassOwner().drawLineEffectsPass(k, options);\n}",
            renderer_content,
        )
        self.assertIn(
            'function drawTextureLabelEffectsPass(k) {\n  return recordLabelPass("textureLabels", () => getVisualEffectsPassOwner().drawTextureLabelEffectsPass(k));\n}',
            renderer_content,
        )
        self.assertIn(
            "function drawDayNightPass(k, options = undefined) {\n  return getVisualEffectsPassOwner().drawDayNightPass(k, options);\n}",
            renderer_content,
        )
        for function_name in (
            "drawContextBasePass",
            "drawContextScenarioPass",
        ):
            self.assertIn(
                f"function {function_name}(k, options = undefined) {{\n"
                f"  return getContextPassOrchestratorOwner().{function_name}(k, options);\n"
                "}",
                renderer_content,
            )
        self.assertRegex(
            renderer_content,
            re.compile(
                r'function drawContextMarkersPass\(k, options = undefined\) \{.*?'
                r'getTransportOverviewRenderOwner\(\)\.resetLabelCandidates\(\);\s*'
                r'invalidateRenderPasses\("labels", "transport-label-candidates"\);\s*'
                r'return getContextPassOrchestratorOwner\(\)\.drawContextMarkersPass\(k, options\);\s*\}',
                re.S,
            ),
        )
        self.assertIn("export function createVisualEffectsPassOwner({", visual_effects_owner_content)
        self.assertIn("export function createContextPassOrchestratorOwner({", context_pass_owner_content)
        self.assertIn("export function createPoliticalPassOrchestratorOwner({", political_pass_owner_content)
        for token in (
            "runtimeState",
            "RendererRuntimeContext",
            "document.",
            "window.",
            "globalThis",
            "d3.",
            'from "../map_renderer.js"',
        ):
            self.assertNotIn(token, visual_effects_owner_content)
            self.assertNotIn(token, context_pass_owner_content)
        for token in (
            "runtimeState",
            "getTransportOverviewRenderOwner",
            "getPhysicalLandMaskInfo",
            "getEffectiveCityCollection",
            "getStrategicValuesResourceFeatureCount",
            "document.",
            "window.",
            "globalThis",
            "d3.",
        ):
            self.assertNotIn(token, context_pass_owner_content)
        for function_name in (
            "drawOldPaperTexture",
            "drawGraticuleTextureLines",
            "drawGraticuleTextureLabels",
            "drawDraftGridTexture",
        ):
            self.assertIn(f"function {function_name}(", visual_effects_owner_content)
            self.assertNotIn(f"function {function_name}(", renderer_content)
        self.assertIn("function drawNightLightsLayer(", renderer_content)
        for token in (
            "const textureAssetCache = new Map();",
            "const texturePatternCache = new Map();",
            "const textureGeometryCache = new Map();",
            "const textureNoiseTileCache = new Map();",
        ):
            self.assertIn(token, visual_effects_owner_content)
            self.assertNotIn(token, renderer_content)
        self.assertIn(
            "getVisualEffectsPassOwner().invalidateTextureRasterCaches();",
            renderer_content,
        )
        self.assertIn("function drawDayNightShadowLayer(", day_night_owner_content)
        for function_name in (
            "drawPhysicalContourLayer",
            "drawUrbanLayer",
            "drawRiversLayer",
            "drawStrategicResourceMarkersLayer",
            "drawCityPointsLayer",
            "drawScenarioRegionOverlaysPass",
            "drawScenarioReliefOverlaysPass",
        ):
            self.assertIn(f"function {function_name}(", renderer_content)
        self.assertIn("function resolveContextBaseDeferredSnapshot() {", renderer_content)
        self.assertIn("function resolveContextMarkersDeferredSnapshot() {", renderer_content)
        for token in (
            "maskInfo: getPhysicalLandMaskInfo(),",
            "urbanFeatureCount: getFeatureCollectionFeatureCount(runtimeState.urbanData),",
            "cityFeatureCount: getFeatureCollectionFeatureCount(getEffectiveCityCollection()),",
            "strategicResourceFeatureCount: getStrategicValuesResourceFeatureCount(",
            "airportFeatureCount: getFeatureCollectionFeatureCount(runtimeState.airportsData),",
            "portFeatureCount: getFeatureCollectionFeatureCount(runtimeState.portsData),",
            "roadFeatureCount: getFeatureCollectionFeatureCount(runtimeState.roadsData),",
            "railwayFeatureCount: getFeatureCollectionFeatureCount(runtimeState.railwaysData),",
        ):
            self.assertIn(token, renderer_content)
        for token in (
            "getTransportOverviewRenderOwner().drawRoadsLayer(k, options)",
            "getTransportOverviewRenderOwner().drawRailwaysLayer(k, options)",
            "getTransportOverviewRenderOwner().drawAirportsLayer(k, options)",
            "getTransportOverviewRenderOwner().drawPortsLayer(k, options)",
            "drawStrategicResourceMarkersLayer,",
            "drawCityPointsLayer,",
            "drawScenarioRegionOverlaysPass,",
            "drawScenarioReliefOverlaysPass,",
        ):
            self.assertIn(token, renderer_content)
        self.assertIn("function getRenderPipelinePassesOwner() {", renderer_content)
        self.assertNotIn("EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES", renderer_content)
        self.assertNotIn(
            "exactAfterSettleDeferredPassNames: EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,",
            renderer_content,
        )
        self.assertIn("resolveExactAfterSettleTargetPasses", exact_scheduler_content)
        self.assertIn("drawContextScenarioPass,", renderer_content)
        self.assertIn("drawTextureLabelEffectsPass,", renderer_content)
        self.assertIn("getContextScenarioReuseDecision,", renderer_content)
        self.assertIn("tryPartialPoliticalPassRepaint,", renderer_content)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+getIdleRenderPassDefinitions\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+prepareIdleRenderPassDefinition\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+ensureIdleRenderPasses\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+getIdleRenderPassDefinitions\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+prepareIdleRenderPassDefinition\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+ensureIdleRenderPasses\s*\(", renderer_content))
        # Exact-resolution export reuses the owner's pass catalog in its isolated cache.
        # Interactive idle scheduling remains in the extracted scheduler.
        pass_catalog_call = "getRenderPipelinePassesOwner().getIdleRenderPassDefinitions()"
        self.assertEqual(renderer_content.count(pass_catalog_call), 1)
        export_content = renderer_content.split("function renderExportPassesToCanvas(", 1)[1].split(
            "\nfunction composeTransformedFrameToBuffer(", 1
        )[0]
        self.assertEqual(export_content.count(pass_catalog_call), 1)
        self.assertEqual(exact_scheduler_content.count("getRenderPipelinePassesOwner().getIdleRenderPassDefinitions()"), 4)
        self.assertEqual(
            renderer_content.count(
                "getRenderPipelinePassesOwner().prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache);"
            ),
            0,
        )
        self.assertEqual(
            exact_scheduler_content.count(
                "getRenderPipelinePassesOwner().prepareIdleRenderPassDefinition(passName, drawFn, transform, timings, cache);"
            ),
            2,
        )
        self.assertEqual(renderer_content.count("getRenderPipelinePassesOwner().ensureIdleRenderPasses("), 2)

        self.assertIn("export function createRenderPipelinePassesOwner({", owner_content)
        self.assertIn('from "./render_pipeline_catalog.js";', owner_content)
        self.assertIn('from "./exact_after_settle_pass_catalog.js";', owner_content)
        self.assertIn(
            "exactAfterSettleDeferredPassNames = EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES,",
            owner_content,
        )
        self.assertIn("function getIdleRenderPassDefinitions() {", owner_content)
        self.assertIn("IDLE_RENDER_PASS_DEFINITIONS.map", owner_content)
        self.assertNotIn('["background", (k) => drawBackgroundPass(k)],', owner_content)
        self.assertNotIn('["contextScenario", (k) => drawContextScenarioPass(k)],', owner_content)
        self.assertNotIn('["textureLabels", (k) => drawTextureLabelEffectsPass(k)],', owner_content)
        self.assertIn("export const IDLE_RENDER_PASS_DEFINITIONS = [", pipeline_catalog_content)
        self.assertIn('passName: "background", drawKey: "drawBackgroundPass"', pipeline_catalog_content)
        self.assertIn('passName: "contextScenario", drawKey: "drawContextScenarioPass"', pipeline_catalog_content)
        self.assertIn('passName: "textureLabels", drawKey: "drawTextureLabelEffectsPass"', pipeline_catalog_content)
        self.assertIn("function shouldDeferExactAfterSettlePassForCriticalPaint(passName", owner_content)
        self.assertIn("function prepareIdleRenderPassDefinition(passName, drawFn, transform, timings", owner_content)
        self.assertIn('recordRenderPerfMetric("contextScenarioSignatureChanged"', owner_content)
        self.assertIn('recordRenderPerfMetric("contextScenarioReuseSkipped"', owner_content)
        self.assertIn('tryPartialPoliticalPassRepaint(transform, nextSignature, timings)', owner_content)
        self.assertIn("function getPoliticalPassFineBaselineMismatch(", renderer_content)
        visible_frame_policy_content = (
            REPO_ROOT / "js" / "core" / "renderer" / "visible_frame_identity_policy.js"
        ).read_text(encoding="utf-8")
        self.assertIn("const politicalPassCurrent = !!(", visible_frame_policy_content)
        self.assertIn('return "coarse-baseline";', renderer_content)
        self.assertIn('return "scene-snapshot-mismatch";', renderer_content)
        self.assertIn('return "scenario-data-generation-mismatch";', renderer_content)
        political_partial_owner_content = (
            REPO_ROOT / "js" / "core" / "renderer" / "political_partial_repaint_owner.js"
        ).read_text(encoding="utf-8")
        partial_repaint_body = political_partial_owner_content.split(
            "function tryPartialPoliticalPassRepaint(", 1
        )[1].split("\n  function recordPoliticalRasterWorkerSnapshot", 1)[0]
        self.assertIn("const fineBaselineMismatch = helper.getPoliticalPassFineBaselineMismatch(transform);", partial_repaint_body)
        self.assertIn("return fallback(fineBaselineMismatch);", partial_repaint_body)
        political_draw_body = political_pass_owner_content.split("function drawBasePoliticalPass(", 1)[1].split(
            "\n  return Object.freeze",
            1,
        )[0]
        self.assertIn('politicalDataStage: "coarse"', political_draw_body)
        self.assertIn('politicalDataStage: "fine"', political_draw_body)
        self.assertIn('finePoliticalCacheReady: true', political_draw_body)
        self.assertIn(
            "function isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(",
            political_background_owner_content,
        )
        self.assertIn(
            'cancelScenarioPoliticalBackgroundDeferredFullCache("scene-snapshot-mismatch");',
            political_background_owner_content,
        )
        political_build_helpers = (
            REPO_ROOT / "js" / "core" / "renderer" / "political_background_build_helpers.js"
        ).read_text(encoding="utf-8")
        self.assertIn("createDeferredPoliticalBackgroundBuildState(", political_background_owner_content)
        self.assertIn("sceneGeneration: identity.sceneGeneration,", political_build_helpers)
        self.assertIn("scenarioDataGeneration: identity.scenarioDataGeneration,", political_build_helpers)
        self.assertIn(
            "function drawBackgroundPass() {\n  return getPoliticalBackgroundRenderOwner().drawBackgroundPass();\n}",
            renderer_content,
        )
        self.assertIn("function ensureIdleRenderPasses(timings, passNames = null) {", owner_content)
        self.assertIn(
            "canYieldRenderPassWork: () => runtimeState.firstVisibleFramePainted\n"
            "        && isBootInteractionReady() && !hasPendingPoliticalColorEdit()",
            renderer_content,
        )
        self.assertIn("const activePassNames = getActiveRenderPassNames();", owner_content)
        self.assertIn("!Array.isArray(activePassNames) || activePassNames.includes(name)", owner_content)
        self.assertIn("detectContextScenarioReasonMismatch({ cache, renderPerf: state.renderPerfMetrics || {} });", owner_content)
        self.assertIn('from "../renderer/exact_after_settle_pass_catalog.js";', exact_plan_content)
        self.assertNotIn("const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set", exact_plan_content)
        self.assertNotIn("const EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = [", exact_plan_content)
        self.assertIn("export const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set", exact_pass_catalog_content)
        self.assertIn("export const EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = [", exact_pass_catalog_content)
        self.assertIn("export function getExactAfterSettleDprRestorePasses(", exact_pass_catalog_content)
        self.assertIn("function resolveExactAfterSettleTargetPasses({", exact_plan_content)
        self.assertIn("function filterExactAfterSettleIdleRenderPassDefinitions(", exact_plan_content)
        self.assertIn("filterExactAfterSettleIdleRenderPassDefinitions(", exact_scheduler_content)

    def test_water_hover_uses_svg_overlay_while_selection_invalidates_composite_only(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        water_token_body = renderer_content.split("function getScenarioWaterVisualRevisionToken({ effectiveWaterFeatureCount = null, atlantropaFeatures = null } = {}) {", 1)[1].split("\n}", 1)[0]
        scenario_overlay_content = (MAP_RENDERER_JS.parent / "renderer" / "scenario_region_overlay_render_owner.js").read_text(encoding="utf-8")
        self.assertIn("getScenarioRegionOverlayRenderOwner().drawScenarioRegionOverlaysPass(k)", renderer_content)
        water_highlight_body = scenario_overlay_content.split("function drawScenarioWaterHighlightLayer(k) {", 1)[1].split(
            "\n  function drawScenarioSpecialRegionOverlaysLayer",
            1,
        )[0]
        hover_overlay_body = (MAP_RENDERER_JS.parent / "renderer" / "transient_overlay_render_owner.js").read_text(encoding="utf-8")
        self.assertIn("getTransientOverlayRenderOwner().renderHoverOverlay()", renderer_content)

        selection_token = '`water-selected:${String(runtimeState.selectedWaterRegionId || "").trim()}`'
        composite_token_body = renderer_content.split("function getScenarioOverlaySignatureToken() {", 1)[1].split("\n}", 1)[0]
        self.assertNotIn(selection_token, water_token_body)
        self.assertIn(selection_token, composite_token_body)
        self.assertIn('String(runtimeState.selectedWaterRegionId || "").trim()', water_highlight_body)
        self.assertNotIn("runtimeState.hoveredWaterRegionId", water_highlight_body)
        self.assertIn('.attr("stroke-linejoin", "round")', hover_overlay_body)
        self.assertIn('.attr("stroke-linecap", "round")', hover_overlay_body)
        self.assertIn('runtimeState.hoveredWaterRegionId ? 1.25 : 1.45', hover_overlay_body)


    def test_empty_click_clears_water_and_special_selection(self):
        owner_content = CLICK_SELECTION_OWNER_JS.read_text(encoding="utf-8")
        click_body = owner_content.split("async function handleClick(event, _interactionContext = null) {", 1)[1].split(
            "\n\n  return Object.freeze({ handleClick });",
            1,
        )[0]
        empty_click_body = click_body.split('if (target.kind === "empty" || !id) {', 1)[1].split("\n  }", 1)[0]

        self.assertIn("setClickSelectedWaterRegionId(\"\");", empty_click_body)
        self.assertIn("refreshWaterRegionSidebarRowsNow([previousWaterRegionId]);", empty_click_body)
        self.assertIn('requestInteractionRender("clear-water-selection-empty-click");', empty_click_body)
        self.assertIn("setClickSelectedSpecialRegionId(\"\");", empty_click_body)
        self.assertIn("refreshSpecialRegionSidebarRowsNow([previousSpecialRegionId]);", empty_click_body)
        self.assertIn('requestInteractionRender("clear-special-selection-empty-click");', empty_click_body)

    def test_selection_only_water_click_paths_request_interaction_render(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = CLICK_SELECTION_OWNER_JS.read_text(encoding="utf-8")
        click_body = owner_content.split("async function handleClick(event, _interactionContext = null) {", 1)[1].split(
            "\n\n  return Object.freeze({ handleClick });",
            1,
        )[0]
        water_click_body = click_body.split('if (target.kind === "water") {', 1)[1].split(
            '\n    if (target.kind !== "land")',
            1,
        )[0]
        special_click_body = click_body.split('if (target.kind === "special") {', 1)[1].split(
            '\n  if (target.kind === "water")',
            1,
        )[0]

        self.assertRegex(
            special_click_body,
            re.compile(
                r'setClickSelectedSpecialRegionId\(id\);[\s\S]*?'
                r'refreshSpecialRegionSidebarRowsNow\(\[previousSpecialRegionId, id\]\);[\s\S]*?'
                r'requestInteractionRender\("select-special-region"\);',
                re.S,
            ),
        )
        self.assertRegex(
            water_click_body,
            re.compile(
                r'if \(macroOceanSelectionOnly\) \{\s*'
                r'requestInteractionRender\("click-select-open-ocean"\);',
                re.S,
            ),
        )
        self.assertRegex(
            water_click_body,
            re.compile(
                r'if \(state\.currentTool === "eyedropper"\) \{[\s\S]*?'
                r'requestInteractionRender\("eyedropper-water"\);[\s\S]*?'
                r'noteRenderAction\("eyedropper-water"',
                re.S,
            ),
        )
        self.assertRegex(
            click_body,
            re.compile(
                r'if \(state\.selectedWaterRegionId\) \{[\s\S]*?'
                r'setClickSelectedWaterRegionId\(""\);[\s\S]*?'
                r'refreshWaterRegionSidebarRowsNow\(\[previousWaterRegionId\]\);[\s\S]*?'
                r'requestInteractionRender\("clear-water-selection-land-click"\);',
                re.S,
            ),
        )
        self.assertRegex(
            click_body,
            re.compile(
                r'if \(state\.selectedSpecialRegionId\) \{[\s\S]*?'
                r'setClickSelectedSpecialRegionId\(""\);[\s\S]*?'
                r'refreshSpecialRegionSidebarRowsNow\(\[previousSpecialRegionId\]\);[\s\S]*?'
                r'requestInteractionRender\("clear-special-selection-land-click"\);',
                re.S,
            ),
        )
        self.assertRegex(
            renderer_content,
            re.compile(
                r'function applyWaterRegionFill[\s\S]*?if \(currentColor === color\) \{[\s\S]*?'
                r'refreshWaterRegionSidebarRowsNow\(\[resolvedId\]\);[\s\S]*?'
                r'requestInteractionRender\(kind\);[\s\S]*?'
                r'return false;',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
