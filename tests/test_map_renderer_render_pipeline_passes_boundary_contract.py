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
HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "hgo_runtime_preview_render_owner.js"
HGO_RUNTIME_PREVIEW_FRAME_COMMIT_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "hgo_runtime_preview_frame_commit.js"
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
            "function drawTextureLabelEffectsPass(k) {\n  return getVisualEffectsPassOwner().drawTextureLabelEffectsPass(k);\n}",
            renderer_content,
        )
        self.assertIn(
            "function drawDayNightPass(k, options = undefined) {\n  return getVisualEffectsPassOwner().drawDayNightPass(k, options);\n}",
            renderer_content,
        )
        for function_name in (
            "drawContextBasePass",
            "drawContextMarkersPass",
            "drawContextScenarioPass",
        ):
            self.assertIn(
                f"function {function_name}(k, options = undefined) {{\n"
                f"  return getContextPassOrchestratorOwner().{function_name}(k, options);\n"
                "}",
                renderer_content,
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
        self.assertIn("drawHgoPreviewPass,", renderer_content)
        self.assertIn("drawTextureLabelEffectsPass,", renderer_content)
        self.assertIn("getContextScenarioReuseDecision,", renderer_content)
        self.assertIn("tryPartialPoliticalPassRepaint,", renderer_content)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+getIdleRenderPassDefinitions\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+prepareIdleRenderPassDefinition\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+ensureIdleRenderPasses\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+getIdleRenderPassDefinitions\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+prepareIdleRenderPassDefinition\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+ensureIdleRenderPasses\s*\(", renderer_content))
        self.assertEqual(renderer_content.count("getRenderPipelinePassesOwner().getIdleRenderPassDefinitions()"), 0)
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
        self.assertNotIn('["hgoPreview", (k) => drawHgoPreviewPass(k)],', owner_content)
        self.assertNotIn('["contextScenario", (k) => drawContextScenarioPass(k)],', owner_content)
        self.assertNotIn('["textureLabels", (k) => drawTextureLabelEffectsPass(k)],', owner_content)
        self.assertIn("export const IDLE_RENDER_PASS_DEFINITIONS = [", pipeline_catalog_content)
        self.assertIn('passName: "background", drawKey: "drawBackgroundPass"', pipeline_catalog_content)
        self.assertIn('passName: "hgoPreview", drawKey: "drawHgoPreviewPass"', pipeline_catalog_content)
        self.assertIn('passName: "contextScenario", drawKey: "drawContextScenarioPass"', pipeline_catalog_content)
        self.assertIn('passName: "textureLabels", drawKey: "drawTextureLabelEffectsPass"', pipeline_catalog_content)
        self.assertIn("function shouldDeferExactAfterSettlePassForCriticalPaint(passName", owner_content)
        self.assertIn("function prepareIdleRenderPassDefinition(passName, drawFn, transform, timings", owner_content)
        self.assertIn('recordRenderPerfMetric("contextScenarioSignatureChanged"', owner_content)
        self.assertIn('recordRenderPerfMetric("contextScenarioReuseSkipped"', owner_content)
        self.assertIn("function didHgoPreviewVisibilityTokenChange(previousSignature, nextSignature)", owner_content)
        self.assertIn('cache.reasons[passName] = "hgo-runtime-preview";', owner_content)
        self.assertIn('tryPartialPoliticalPassRepaint(transform, nextSignature, timings)', owner_content)
        self.assertIn("function getPoliticalPassFineBaselineMismatch(", renderer_content)
        self.assertIn("const politicalPassCurrent = !!(", renderer_content)
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
        political_draw_body = political_pass_owner_content.split("function drawPoliticalPass(", 1)[1].split(
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
        self.assertIn("sceneGeneration: identity.sceneGeneration,", political_background_owner_content)
        self.assertIn("scenarioDataGeneration: identity.scenarioDataGeneration,", political_background_owner_content)
        self.assertIn(
            "function drawBackgroundPass() {\n  return getPoliticalBackgroundRenderOwner().drawBackgroundPass();\n}",
            renderer_content,
        )
        self.assertIn("function ensureIdleRenderPasses(timings, passNames = null) {", owner_content)
        self.assertIn("const requestedPassNames = Array.isArray(passNames) ? new Set(passNames.filter(Boolean)) : null;", owner_content)
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

    def test_water_hover_uses_svg_overlay_while_selected_water_invalidates_canvas_layer(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        water_token_body = renderer_content.split("function getScenarioWaterVisualRevisionToken() {", 1)[1].split("\n}", 1)[0]
        water_highlight_body = renderer_content.split("function drawScenarioWaterHighlightLayer(k) {", 1)[1].split(
            "\nfunction drawScenarioSpecialRegionOverlaysLayer",
            1,
        )[0]
        hover_overlay_body = (MAP_RENDERER_JS.parent / "renderer" / "transient_overlay_render_owner.js").read_text(encoding="utf-8")
        self.assertIn("getTransientOverlayRenderOwner().renderHoverOverlay()", renderer_content)

        self.assertIn('`water-selected:${String(runtimeState.selectedWaterRegionId || "").trim()}`', water_token_body)
        self.assertIn('String(runtimeState.selectedWaterRegionId || "").trim()', water_highlight_body)
        self.assertNotIn("runtimeState.hoveredWaterRegionId", water_highlight_body)
        self.assertIn('.attr("stroke-linejoin", "round")', hover_overlay_body)
        self.assertIn('.attr("stroke-linecap", "round")', hover_overlay_body)
        self.assertIn('runtimeState.hoveredWaterRegionId ? 1.25 : 1.45', hover_overlay_body)

    def test_hgo_preview_ready_replaces_normal_overlay_passes(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        visual_effects_owner_content = VISUAL_EFFECTS_PASS_OWNER_JS.read_text(encoding="utf-8")
        context_pass_owner_content = CONTEXT_PASS_ORCHESTRATOR_OWNER_JS.read_text(encoding="utf-8")
        political_pass_owner_content = POLITICAL_PASS_ORCHESTRATOR_OWNER_JS.read_text(encoding="utf-8")
        draw_canvas_owner_content = DRAW_CANVAS_ORCHESTRATION_OWNER_JS.read_text(encoding="utf-8")
        hgo_preview_owner_content = HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS.read_text(encoding="utf-8")
        hgo_preview_commit_content = HGO_RUNTIME_PREVIEW_FRAME_COMMIT_JS.read_text(encoding="utf-8")
        render_pass_commit_owner_content = RENDER_PASS_COMMIT_ACCOUNTING_OWNER_JS.read_text(encoding="utf-8")
        render_pass_catalog_content = RENDER_PASS_CATALOG_JS.read_text(encoding="utf-8")
        signature_body = renderer_content.split("function getRenderPassSignature(passName", 1)[1].split(
            "\nfunction resolveHitMode",
            1,
        )[0]

        self.assertIn("function getHgoRuntimePreviewVisibilitySignature() {", renderer_content)
        hgo_signature_body = signature_body.split('if (passName === "hgoPreview")', 1)[1].split(
            "\n  if (passName === ",
            1,
        )[0]
        self.assertIn('isHgoRuntimePreviewReady() ? "hgo:on" : "hgo:off"', hgo_signature_body)
        self.assertIn('String(preview.status || "")', hgo_signature_body)
        self.assertIn('rendererSurfaceHost.getProjection() ? transformSignature : "projection:none"', hgo_signature_body)
        hgo_preview_pass_body = hgo_preview_owner_content.split("function drawPreviewPass()", 1)[1].split(
            "\n\n  function normalizeHitPayload",
            1,
        )[0]
        hgo_preview_commit_body = hgo_preview_commit_content.split("function drawPreviewPass()", 1)[1].split(
            "\n\n  return Object.freeze",
            1,
        )[0]
        self.assertIn("return frameCommitter.drawPreviewPass();", hgo_preview_pass_body)
        self.assertIn('renderFrame: (targetCanvas) => renderIfReady("hgo-preview-pass", {', hgo_preview_owner_content)
        self.assertLess(
            hgo_preview_commit_body.index("if (!isReady())"),
            hgo_preview_commit_body.index("const targetCanvas = getTargetCanvas();"),
        )
        self.assertLess(
            hgo_preview_commit_body.index("getFrameRejectionReason(rendered, stats)"),
            hgo_preview_commit_body.index("resetCanvasContext(targetContext, targetCanvas.width, targetCanvas.height);"),
        )
        self.assertNotIn("projectionTransform: null", hgo_preview_owner_content)
        self.assertIn('const HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES = Object.freeze([\n  "hgoPreview",\n]);', hgo_preview_owner_content)
        self.assertIn(
            'const HGO_RUNTIME_PREVIEW_TRANSFORMED_FRAME_PASS_NAMES = Object.freeze([\n  "hgoPreview",\n]);',
            hgo_preview_owner_content,
        )
        self.assertIn("return getHgoRuntimePreviewRenderOwner().getActiveRenderPassNames();", renderer_content)
        self.assertIn(
            "return isReady() ? HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES : vectorRenderPassNames;",
            hgo_preview_owner_content,
        )
        self.assertIn("return getHgoRuntimePreviewRenderOwner().getActiveTransformedFramePassNames();", renderer_content)
        self.assertIn(
            "return isReady() ? HGO_RUNTIME_PREVIEW_TRANSFORMED_FRAME_PASS_NAMES : vectorTransformedFramePassNames;",
            hgo_preview_owner_content,
        )
        interaction_composite_body = render_pass_catalog_content.split("export const INTERACTION_COMPOSITE_PASS_NAMES = [", 1)[1].split(
            "];",
            1,
        )[0]
        self.assertNotIn('"hgoPreview"', interaction_composite_body)
        self.assertIn("const activeRenderPassNames = getActiveRenderPassNames();", draw_canvas_owner_content)
        self.assertIn("ensureIdleRenderPasses(frameTimings, activeRenderPassNames);", draw_canvas_owner_content)
        self.assertIn("drewExactFrame = !!composeCachedPasses(activeRenderPassNames);", draw_canvas_owner_content)
        self.assertIn("function getProjectedHgoRuntimePreviewBounds() {", renderer_content)
        self.assertIn("function getProjectedBounds() {", hgo_preview_owner_content)
        viewport_owner_content = VIEWPORT_READ_MODEL_OWNER_JS.read_text(encoding="utf-8")
        render_pass_commit_body = render_pass_commit_owner_content.split("function commitRenderPass({", 1)[1].split(
            "\n  return Object.freeze",
            1,
        )[0]
        self.assertLess(
            render_pass_commit_body.index("drawResult.committed === false"),
            render_pass_commit_body.index('"setPassReferenceTransform"'),
        )
        self.assertIn('"renderPassCommitSkipped"', render_pass_commit_body)
        self.assertIn("cache.politicalPassDataStage = politicalDataStage;", render_pass_commit_body)
        self.assertIn("cache.politicalPassFineCacheReady = politicalFineCacheReady;", render_pass_commit_body)
        self.assertIn("if (politicalFineCacheReady) {", render_pass_commit_body)
        self.assertIn('"clearPassFullReferenceTransforms"', render_pass_commit_body)
        self.assertLess(
            render_pass_commit_body.index("if (politicalFineCacheReady) {"),
            render_pass_commit_body.index("cache.partialPoliticalDirtyIds.clear();"),
        )
        self.assertIn("function getProjectedRenderableContentBounds()", viewport_owner_content)
        viewport_factory = renderer_content.split("function getViewportReadModelOwner()", 1)[1].split(
            "function getViewportCommandOwner()", 1,
        )[0]
        self.assertIn('readBoundsSnapshots("getProjectedRenderableContentBoundsSnapshots")', viewport_owner_content)
        for getter in ["getPanContentBoundsSnapshots", "getProjectedRenderableContentBoundsSnapshots"]:
            getter_body = viewport_factory.split(getter + ": () => {", 1)[1].split("const features", 1)[0]
            self.assertIn("if (isHgoRuntimePreviewReady()) return [snapshotBounds(getProjectedHgoRuntimePreviewBounds())];", getter_body)
        self.assertIn("return getViewportReadModelOwner().getProjectedRenderableContentBounds();", renderer_content)
        viewport_command_owner_content = VIEWPORT_COMMAND_OWNER_JS.read_text(encoding="utf-8")
        pan_extent_body = renderer_content.split("function calculatePanExtent()", 1)[1].split(
            "\n\nfunction updateZoomTranslateExtent",
            1,
        )[0]
        self.assertIn("return getViewportReadModelOwner().calculatePanExtent();", pan_extent_body)
        reset_zoom_body = viewport_command_owner_content.split("function resetZoomToFit(", 1)[1].split(
            "\n\n  function zoomByStep",
            1,
        )[0]
        self.assertIn("return getViewportCommandOwner().resetZoomToFit({ centerContent, centerX, centerY });", renderer_content)
        self.assertLess(
            reset_zoom_body.index("updateZoomTranslateExtent();"),
            reset_zoom_body.index("const transform = centerContent"),
        )
        self.assertEqual(signature_body.count("getHgoRuntimePreviewVisibilitySignature()"), 7)
        political_body = signature_body.split('if (passName === "political")', 1)[1].split(
            "\n  if (passName === ",
            1,
        )[0]
        self.assertLess(
            political_body.index("runtimeState.colorRevision || 0"),
            political_body.index("getHgoRuntimePreviewVisibilitySignature()"),
        )
        for pass_name in (
            "political",
            "contextBase",
            "contextMarkers",
            "labels",
            "contextScenario",
            "textureLabels",
            "borders",
        ):
            pass_body = signature_body.split(f'if (passName === "{pass_name}")', 1)[1].split(
                "\n  if (passName === ",
                1,
            )[0]
            self.assertIn("getHgoRuntimePreviewVisibilitySignature()", pass_body)

        for function_name in (
            "drawPoliticalPass",
            "drawContextBasePass",
            "drawContextMarkersPass",
            "drawContextScenarioPass",
            "drawTextureLabelEffectsPass",
            "drawBordersPass",
            "drawLabelsPass",
        ):
            if function_name == "drawTextureLabelEffectsPass":
                source = visual_effects_owner_content
            elif function_name == "drawPoliticalPass":
                source = political_pass_owner_content
            elif function_name in {
                "drawContextBasePass",
                "drawContextMarkersPass",
                "drawContextScenarioPass",
            }:
                source = context_pass_owner_content
            else:
                source = renderer_content
            pass_body = source.split(f"function {function_name}(", 1)[1].split("\n  function ", 1)[0].split("\nfunction ", 1)[0]
            if function_name in {
                "drawContextBasePass",
                "drawContextMarkersPass",
                "drawContextScenarioPass",
            }:
                self.assertIn(
                    f'if (recordHgoSkip("{function_name}", startedAt, interactive)) return;',
                    pass_body,
                )
                continue
            self.assertRegex(
                pass_body,
                re.compile(
                    r"if \(isHgoRuntimePreviewReady\(\)\) \{[\s\S]*?"
                    r'reason: "hgo-runtime-preview"[\s\S]*?'
                    r"return;",
                    re.S,
                ),
            )
        record_hgo_skip_body = context_pass_owner_content.split("function recordHgoSkip(", 1)[1].split(
            "\n\n  function drawContextBasePass",
            1,
        )[0]
        self.assertIn("if (!isHgoRuntimePreviewReady()) return false;", record_hgo_skip_body)
        self.assertIn('reason: "hgo-runtime-preview"', record_hgo_skip_body)

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
