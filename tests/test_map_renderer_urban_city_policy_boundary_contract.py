from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
URBAN_CITY_POLICY_JS = REPO_ROOT / "js" / "core" / "renderer" / "urban_city_policy.js"
CITY_POINTS_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "city_points_render_owner.js"
CITY_LIGHTS_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "city_lights_render_owner.js"
DAY_NIGHT_RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "day_night_runtime_owner.js"


class MapRendererUrbanCityPolicyBoundaryContractTest(unittest.TestCase):
    def get_map_renderer_export_block(self, renderer_content):
        marker = "// Batch 5 facade note:"
        start = renderer_content.index(marker)
        block_start = renderer_content.index("export {", start)
        block_end = renderer_content.index("};", block_start)
        return renderer_content[block_start:block_end]

    def test_map_renderer_keeps_facade_while_urban_city_policy_owns_policy_logic(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        policy_content = URBAN_CITY_POLICY_JS.read_text(encoding="utf-8")
        reveal_content = (URBAN_CITY_POLICY_JS.parent / "city_reveal_policy.js").read_text(encoding="utf-8")
        city_points_owner_content = CITY_POINTS_RENDER_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")
        renderer_export_block = self.get_map_renderer_export_block(renderer_content)

        self.assertIn(
            "import { createUrbanCityPolicyOwner, getUrbanCityRenderPassSignatureParts } from './renderer/urban_city_policy.js';",
            renderer_imports,
        )
        self.assertIn("import { createCityPointsRenderOwner } from './renderer/city_points_render_owner.js';", renderer_imports)
        self.assertIn("let urbanCityPolicyOwner = null;", renderer_content)
        self.assertIn("let cityPointsRenderOwner = null;", renderer_content)
        self.assertIn("function getUrbanCityPolicyOwner() {", renderer_content)
        self.assertIn("function getCityPointsRenderOwner() {", renderer_content)
        self.assertIn("const buildCityRevealPlan = (...args) => getUrbanCityPolicyOwner().buildCityRevealPlan(...args);", renderer_content)
        self.assertIn("const getEffectiveCityCollection = (...args) => getUrbanCityPolicyOwner().getEffectiveCityCollection(...args);", renderer_content)
        self.assertIn("buildCityRevealPlan,", renderer_export_block)
        self.assertIn("getEffectiveCityCollection,", renderer_export_block)
        self.assertNotIn("getCityScenarioTag", renderer_export_block)
        self.assertNotIn("doesScenarioCountryHideCityPoints", renderer_export_block)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+getCityScenarioTag\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+getCityScenarioTag\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+doesScenarioCountryHideCityPoints\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+doesScenarioCountryHideCityPoints\s*\(", renderer_content))
        self.assertNotIn("doesScenarioCountryHideCityPoints,", renderer_content)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+getUrbanFeatureIndex\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+getUrbanFeatureIndex\s*\(", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+getCityUrbanRuntimeInfo\s*=", renderer_content))
        self.assertIsNone(re.search(r"(?m)^\s*function\s+getCityUrbanRuntimeInfo\s*\(", renderer_content))
        self.assertEqual(renderer_content.count("getUrbanCityPolicyOwner().getCityScenarioTag(feature)"), 2)
        self.assertIn("const urbanFeatureIndexCache = {", renderer_content)
        self.assertNotIn("function getUrbanFeatureStableId(feature) {", renderer_content)
        self.assertIn("export function getUrbanFeatureStableId(feature) {", reveal_content)
        self.assertIn("./renderer/city_reveal_policy.js", renderer_content)
        self.assertIn("function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {", renderer_content)
        self.assertIn("return getCityPointsRenderOwner().getCityLayerRenderState(k, { interactive, cacheHoverEntries });", renderer_content)
        self.assertIn("function drawCityPointsLayer(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("return getCityPointsRenderOwner().drawCityPointsLayer(k, { interactive });", renderer_content)
        self.assertIn("function drawLabelsPass(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("return getCityPointsRenderOwner().drawLabelsPass(k, { interactive });", renderer_content)
        self.assertIsNone(re.search(r"function\s+createCityMarkerSpriteCanvas\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+renderCityMarkerSprite\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+cacheVisibleCityHoverEntries\s*\(", renderer_content))
        self.assertIn("const victoryPointValue = Math.max(0, Number(props.__city_scenario_victory_points || 0));", reveal_content)
        self.assertIn("+ (victoryPointValue * 25_000_000)", reveal_content)

        self.assertIn("export function createUrbanCityPolicyOwner({", policy_content)
        self.assertIn("export function getUrbanCityRenderPassSignatureParts(state, passName) {", policy_content)
        self.assertIn("function getUrbanFeatureIndex() {", policy_content)
        self.assertIn("function getCityUrbanRuntimeInfo(feature, urbanIndex = getUrbanFeatureIndex()) {", policy_content)
        self.assertIn("function buildCityRevealPlan(cityCollection, scale, transform, config = {}) {", policy_content)
        self.assertIn("function getCityScenarioTag(feature) {", policy_content)
        self.assertIn("function doesScenarioCountryHideCityPoints(tag) {", policy_content)
        self.assertIn("function applyScenarioCityOverride(feature, overrideEntry) {", policy_content)
        self.assertIn("function applyStrategicVictoryPointRank(feature) {", policy_content)
        self.assertIn("function getEffectiveCityCollection() {", policy_content)

        self.assertIn("export function createCityPointsRenderOwner({", city_points_owner_content)
        self.assertIn("function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {", city_points_owner_content)
        self.assertIn("function drawCityMarkersFromEntries(markerEntries, { config, scale, opacity, interactive = false } = {}) {", city_points_owner_content)
        self.assertIn("function drawCityPointsLayer(k, { interactive = false } = {}) {", city_points_owner_content)
        self.assertIn("function drawLabelsPass(k, { interactive = false } = {}) {", city_points_owner_content)
        self.assertIn("function getHoveredCityEntryFromEvent(event) {", city_points_owner_content)
        self.assertIn("getHoverEntryHitPriority = () => 0,", city_points_owner_content)
        self.assertIn("getPointer = () => null,", city_points_owner_content)
        self.assertIn("getZoomIdentity = () => DEFAULT_ZOOM_IDENTITY,", city_points_owner_content)
        self.assertIn("getPointer: (event, target) => (", renderer_content)
        self.assertIn("getZoomIdentity: () => globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 },", renderer_content)
        self.assertNotIn("getFacilityEntryHitPriority", city_points_owner_content)
        self.assertNotIn("globalThis.d3", city_points_owner_content)
        self.assertIn("let bestPriority = -1;", city_points_owner_content)

        self.assertIsNone(re.search(r"function\s+cloneCityFeature\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+resolveCityFeatureKey\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+getScenarioCountryCodesForTag\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+compareCapitalCandidateEntries\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+applyScenarioCityOverride\s*\(", renderer_content))

    def test_urban_glow_intensity_field_invalidates_and_modulates_urban_light_passes(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        city_lights_content = CITY_LIGHTS_RENDER_OWNER_JS.read_text(encoding="utf-8")
        day_night_owner_content = DAY_NIGHT_RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        intensity_content = (REPO_ROOT / "js" / "core" / "intensity_field.js").read_text(encoding="utf-8")
        context_base_body = renderer_content.split('if (passName === "contextBase") {', 1)[1].split(
            '\n  }',
            1,
        )[0]
        day_night_body = renderer_content.split('if (passName === "dayNight") {', 1)[1].split(
            '\n  }',
            1,
        )[0]
        urban_layer_body = renderer_content.split("function drawUrbanLayer(k, { interactive = false } = {}) {", 1)[1].split(
            "\nfunction recordDeferredRiversLayerMetric",
            1,
        )[0]
        modern_static_key_body = city_lights_content.split("function getModernCityLightsStaticLayerKey(config) {", 1)[1].split(
            "\n}",
            1,
        )[0]
        day_night_signature_body = day_night_owner_content.split(
            "function buildDayNightPassSignature(transformSignature, urbanGlowRevision, topologyRevision) {",
            1,
        )[1].split("\n  }", 1)[0]

        self.assertIn('id: "urbanGlow"', intensity_content)
        self.assertIn('targetPasses: Object.freeze(["contextBase", "dayNight"])', intensity_content)
        self.assertIn("function getIntensityFieldTargetPasses(channelId)", intensity_content)
        self.assertIn('`field:urbanGlow:${Number(intensityFields.channels.urbanGlow?.revision || 0)}`', context_base_body)
        self.assertIn("intensityFields.channels.urbanGlow?.revision", day_night_body)
        self.assertIn('`field:urbanGlow:${Number(urbanGlowRevision || 0)}`', day_night_signature_body)
        self.assertIn('getFieldFeatureMultiplier("urbanGlow", feature)', renderer_content)
        self.assertIn("const glowMultiplier = getUrbanGlowFeatureMultiplier(feature);", urban_layer_body)
        self.assertIn("Math.min(fillOpacity, 0.15) : fillOpacity) * glowMultiplier", urban_layer_body)
        self.assertIn("Math.min(strokeOpacity, 0.18) : strokeOpacity) * glowMultiplier", urban_layer_body)
        self.assertGreaterEqual(
            renderer_content.count("getUrbanGlowMultiplierAt(")
            + city_lights_content.count("getUrbanGlowMultiplierAt("),
            8,
        )
        self.assertIn("const urbanGlowRevision = Number(intensityFields?.channels?.urbanGlow?.revision || 0);", modern_static_key_body)
        self.assertIn('`field:urbanGlow:${urbanGlowRevision}`', modern_static_key_body)


if __name__ == "__main__":
    unittest.main()
