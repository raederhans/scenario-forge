from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CITY_LABEL_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "city_label_owner.js"
CITY_POINTS_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "city_points_render_owner.js"
URBAN_CITY_POLICY_JS = REPO_ROOT / "js" / "core" / "renderer" / "urban_city_policy.js"


class MapRendererCityLabelOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_label_pass_while_city_label_owner_draws_labels(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = CITY_LABEL_OWNER_JS.read_text(encoding="utf-8")
        city_points_owner_content = CITY_POINTS_RENDER_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createCityLabelOwner } from './renderer/city_label_owner.js';",
            renderer_imports,
        )
        self.assertIn("let cityLabelOwner = null;", renderer_content)
        self.assertIn("function getCityLabelOwner() {", renderer_content)
        self.assertIn("drawCityLabelsFromEntries: (...args) => getCityLabelOwner().drawCityLabelsFromEntries(...args),", renderer_content)
        self.assertIsNone(re.search(r"(?m)^\s*(?:const|let|var)\s+drawCityLabelsFromEntries\s*=", renderer_content))
        self.assertIsNone(re.search(r"function\s+drawCityLabelsFromEntries\s*\(", renderer_content))
        self.assertIn("function drawLabelsPass(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("return getCityPointsRenderOwner().drawLabelsPass(k, { interactive });", renderer_content)
        self.assertIn("const labelCount = drawCityLabelsFromEntries(renderState.labelEntries, {", city_points_owner_content)

        self.assertIn("export function createCityLabelOwner({ constants = {}, getters = {}, helpers = {} } = {}) {", owner_content)
        self.assertIn("function drawCityLabelsFromEntries(labelEntries, { config, scale } = {}) {", owner_content)
        self.assertIn("function doScreenBoxesOverlap(a, b) {", owner_content)
        self.assertIn("function buildCityLabelPlacementCandidates(entry, {", owner_content)
        self.assertIn("const CITY_LABEL_PLACEMENT_ORDER = [", owner_content)
        self.assertNotIn("buildCityLabelPlacementCandidates", renderer_content)
        self.assertNotIn("helpers.buildCityLabelPlacementCandidates", owner_content)
        self.assertIn("entry.acceptedLabelPlacement = acceptedPlacement.id;", owner_content)
        self.assertIn("entry.labelContrastMode = labelStyle.usesLightLabel ? \"light\" : \"default\";", owner_content)
        self.assertIsNone(re.search(r"function\s+doScreenBoxesOverlap\s*\(", renderer_content))

    def test_city_pass_signatures_track_every_city_collection_revision(self):
        signature_content = (URBAN_CITY_POLICY_JS.parent / "render_pass_signature_policy.js").read_text(encoding="utf-8")
        policy_content = URBAN_CITY_POLICY_JS.read_text(encoding="utf-8")
        labels_signature_token = 'if (passName === "labels") {'
        context_markers_signature_token = 'if (passName === "contextMarkers") {'

        self.assertEqual(signature_content.count(labels_signature_token), 1)
        self.assertEqual(signature_content.count(context_markers_signature_token), 1)
        self.assertIn("import { getUrbanCityRenderPassSignatureParts } from './urban_city_policy.js';", signature_content)
        context_markers_signature = signature_content.split(context_markers_signature_token, 1)[1].split(
            labels_signature_token,
            1,
        )[0]
        labels_signature = signature_content.split(labels_signature_token, 1)[1].split(
            'if (passName === "contextScenario") {',
            1,
        )[0]

        self.assertIn(
            '...getUrbanCityRenderPassSignatureParts(runtimeState, "contextMarkers")',
            context_markers_signature,
        )

        for token in [
            "getHgoRuntimePreviewVisibilitySignature()",
            'runtimeState.showBlankFeatureLabels ? "blank-feature-labels:on" : "blank-feature-labels:off"',
            '...getUrbanCityRenderPassSignatureParts(runtimeState, "labels")',
            "stableJson(normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {}))",
        ]:
            self.assertIn(token, labels_signature)

        for token in [
            'state?.deferContextBasePass ? "labels:deferred" : "labels:ready"',
            '`cities:${Number(state?.cityLayerRevision || 0)}`',
            '`strategic:${Number(state?.scenarioStrategicValuesRevision || 0)}`',
            '`sovereignty:${Number(state?.sovereigntyRevision || 0)}`',
            '`colors:${Number(state?.colorRevision || 0)}`',
        ]:
            self.assertIn(token, policy_content)


if __name__ == "__main__":
    unittest.main()
