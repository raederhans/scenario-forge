from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
URBAN_CITY_POLICY_JS = REPO_ROOT / "js" / "core" / "renderer" / "urban_city_policy.js"


class MapRendererUrbanCityPolicyBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_facade_while_urban_city_policy_owns_policy_logic(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        policy_content = URBAN_CITY_POLICY_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createUrbanCityPolicyOwner } from './renderer/urban_city_policy.js';", renderer_imports)
        self.assertIn("let urbanCityPolicyOwner = null;", renderer_content)
        self.assertIn("function getUrbanCityPolicyOwner() {", renderer_content)
        self.assertIn("const buildCityRevealPlan = (...args) => getUrbanCityPolicyOwner().buildCityRevealPlan(...args);", renderer_content)
        self.assertIn("const getEffectiveCityCollection = (...args) => getUrbanCityPolicyOwner().getEffectiveCityCollection(...args);", renderer_content)
        self.assertIn("const getCityScenarioTag = (...args) => getUrbanCityPolicyOwner().getCityScenarioTag(...args);", renderer_content)
        self.assertIn("getUrbanCityPolicyOwner().doesScenarioCountryHideCityPoints(...args);", renderer_content)
        self.assertIn("const getUrbanFeatureIndex = (...args) => getUrbanCityPolicyOwner().getUrbanFeatureIndex(...args);", renderer_content)
        self.assertIn("const getCityUrbanRuntimeInfo = (...args) => getUrbanCityPolicyOwner().getCityUrbanRuntimeInfo(...args);", renderer_content)
        self.assertIn("const urbanFeatureIndexCache = {", renderer_content)
        self.assertIn("function getUrbanFeatureStableId(feature) {", renderer_content)
        self.assertIn("function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {", renderer_content)
        self.assertIn("function drawCityPointsLayer(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function drawLabelsPass(k, { interactive = false } = {}) {", renderer_content)

        self.assertIn("export function createUrbanCityPolicyOwner({", policy_content)
        self.assertIn("function getUrbanFeatureIndex() {", policy_content)
        self.assertIn("function getCityUrbanRuntimeInfo(feature, urbanIndex = getUrbanFeatureIndex()) {", policy_content)
        self.assertIn("function buildCityRevealPlan(cityCollection, scale, transform, config = {}) {", policy_content)
        self.assertIn("function getCityScenarioTag(feature) {", policy_content)
        self.assertIn("function doesScenarioCountryHideCityPoints(tag) {", policy_content)
        self.assertIn("function applyScenarioCityOverride(feature, overrideEntry) {", policy_content)
        self.assertIn("function getEffectiveCityCollection() {", policy_content)

        self.assertIsNone(re.search(r"function\s+cloneCityFeature\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+resolveCityFeatureKey\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+getScenarioCountryCodesForTag\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+compareCapitalCandidateEntries\s*\(", renderer_content))
        self.assertIsNone(re.search(r"function\s+applyScenarioCityOverride\s*\(", renderer_content))


if __name__ == "__main__":
    unittest.main()
