from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CANVAS_COLOR_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "canvas_color_helpers.js"
COLOR_RESOLUTION_STRATEGY_JS = REPO_ROOT / "js" / "core" / "renderer" / "color_resolution_strategy.js"


class MapRendererColorResolutionStrategyBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_color_facade_while_strategy_moves_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = COLOR_RESOLUTION_STRATEGY_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createColorResolutionStrategyOwner } from './renderer/color_resolution_strategy.js';",
            renderer_imports,
        )
        self.assertIn("let colorResolutionStrategyOwner = null;", renderer_content)
        self.assertIn("function getColorResolutionStrategyOwner() {", renderer_content)
        self.assertIn(
            "const getDisplayOwnerCode = (...args) => getColorResolutionStrategyOwner().getDisplayOwnerCode(...args);",
            renderer_content,
        )
        self.assertIn(
            "const getResolvedFeatureColor = (...args) => getColorResolutionStrategyOwner().getResolvedFeatureColor(...args);",
            renderer_content,
        )
        self.assertIn("const resolved = getResolvedFeatureColor(feature, id);", renderer_content)
        rebuild_start = renderer_content.index("function rebuildResolvedColors() {")
        rebuild_end = renderer_content.index("function shouldRefreshContextBaseContoursForColorChanges()", rebuild_start)
        rebuild_body = renderer_content[rebuild_start:rebuild_end]
        self.assertNotIn("getLogicalCanvasDimensions", rebuild_body)
        self.assertNotIn("shouldSkipFeature", rebuild_body)
        self.assertIn("const colorSourceFeatures = getResolvedColorSourceFeatures();", rebuild_body)
        self.assertIn("colorSourceFeatures.forEach((feature, index) => {", rebuild_body)
        self.assertIn("function findResolvedColorFeatureById(featureId) {", rebuild_body)
        self.assertIn("resolvedColorFeatureLookupCache.index.get(id)", rebuild_body)
        refresh_start = renderer_content.index("function refreshResolvedColorsForFeatures(")
        refresh_end = renderer_content.index("function refreshResolvedColorsForOwners(", refresh_start)
        refresh_body = renderer_content[refresh_start:refresh_end]
        self.assertIn("const feature = findResolvedColorFeatureById(id);", refresh_body)
        self.assertIn("function collectResolvedColorFeatureIdsForOwners(ownerCodes = []) {", renderer_content)
        owner_refresh_start = renderer_content.index("function refreshResolvedColorsForOwners(")
        owner_refresh_end = renderer_content.index("function refreshColorState(", owner_refresh_start)
        owner_refresh_body = renderer_content[owner_refresh_start:owner_refresh_end]
        self.assertIn("const ids = collectResolvedColorFeatureIdsForOwners(ownerCodes);", owner_refresh_body)
        derived_start = renderer_content.index("function rebuildRuntimeDerivedState({")
        derived_end = renderer_content.index("async function buildHitCanvasAfterStartup(", derived_start)
        derived_body = renderer_content[derived_start:derived_end]
        self.assertIn("const nextColors = incrementalDelta ? reconcilePoliticalDerivedColors(incrementalDelta) : rebuildResolvedColors();", derived_body)
        self.assertIn("getResolvedFeatureColor(delta.features.get(id), id)", derived_body)
        self.assertNotIn("collectResolvedColor", derived_body)
        self.assertIn("function applyFeatureVisualOverrideTransaction(", renderer_content)
        override_transaction_body = renderer_content.split(
            "function applyFeatureVisualOverrideTransaction(",
            1,
        )[1].split("function refreshResolvedColorsForOwners(", 1)[0]
        # Paint writes moved into the shared state authority; preserve the
        # single transaction and prohibit duplicate renderer writes.
        self.assertIn("applyFeaturePaintState(runtimeState, resolvedIds,", override_transaction_body)
        self.assertIn("refreshResolvedColorsForFeatures(resolvedIds,", override_transaction_body)
        for token in (
            "runtimeState.visualOverrides[targetId] =", "runtimeState.featureOverrides[targetId] =",
            "delete runtimeState.visualOverrides[targetId];", "delete runtimeState.featureOverrides[targetId];",
        ):
            self.assertNotIn(token, renderer_content)
        paint_state_content = (REPO_ROOT / "js/core/state/color_state.js").read_text(encoding="utf-8")
        self.assertIn("export function applyFeaturePaintState(", paint_state_content)
        self.assertIn("target.visualOverrides[id] = color;", paint_state_content)
        self.assertIn("target.featureOverrides[id] = color;", paint_state_content)
        self.assertIn("delete target.visualOverrides[id];", paint_state_content)
        self.assertIn("delete target.featureOverrides[id];", paint_state_content)
        self.assertIn("applyFeatureVisualOverrideTransaction(resolvedIds, color,", renderer_content)
        self.assertIn("applyFeatureVisualOverrideTransaction(freshIds, remove ? null : selectedColor,", renderer_content)
        click_owner_content = (REPO_ROOT / "js/core/map_renderer/click_selection_transaction_owner.js").read_text(encoding="utf-8")
        self.assertIn("applyFeatureVisualOverrideTransaction(targetIds, null,", click_owner_content)

        self.assertIn('import { resolveFeatureColor } from "../color_resolver.js";', owner_content)
        self.assertIn("export function createColorResolutionStrategyOwner({", owner_content)
        self.assertIn("function getDisplayOwnerCode(feature, id) {", owner_content)
        self.assertIn("function getResolvedFeatureColor(feature, id) {", owner_content)
        self.assertIn("getOwnerCode: getDisplayOwnerCode,", owner_content)
        self.assertIn("state.scenarioAutoShellOwnerByFeatureId?.[resolvedId]", owner_content)
        self.assertNotIn("scenarioControllersByFeatureId", owner_content)

        self.assertIsNone(re.search(r"function\s+getDisplayOwnerCode\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+getResolvedFeatureColor\s*\(", renderer_content))
        self.assertNotIn('from "./color_resolver.js"', renderer_content)

    def test_canvas_color_helpers_move_to_renderer_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        helper_content = CANVAS_COLOR_HELPERS_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("from './renderer/canvas_color_helpers.js';", renderer_imports)
        self.assertIn('import { ColorManager } from "../color_manager.js";', helper_content)
        for token in (
            "function isProbablyCanvasColor(value) {",
            "function getSafeCanvasColor(value, fallback) {",
            "function parseCanvasColorChannels(value) {",
            "function getCanvasColorRelativeLuminance(value) {",
            "function mixCanvasColors(baseColor, targetColor, amount) {",
            "getSafeCanvasColor,",
            "parseCanvasColorChannels,",
            "getCanvasColorRelativeLuminance,",
            "mixCanvasColors,",
        ):
            self.assertIn(token, helper_content)

        for token in (
            "const COLOR_HEX_RE =",
            "const COLOR_FUNC_RE =",
            "const COLOR_NAME_RE =",
            "function isProbablyCanvasColor(value) {",
            "function getSafeCanvasColor(value, fallback) {",
            "function parseCanvasColorChannels(value) {",
            "function getCanvasColorRelativeLuminance(value) {",
            "function mixCanvasColors(baseColor, targetColor, amount) {",
        ):
            self.assertNotIn(token, renderer_content)


if __name__ == "__main__":
    unittest.main()
