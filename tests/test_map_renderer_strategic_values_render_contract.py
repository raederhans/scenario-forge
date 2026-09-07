from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
CONTEXT_PASS_ORCHESTRATOR_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "context_pass_orchestrator_owner.js"


class MapRendererStrategicValuesRenderContractTest(unittest.TestCase):
    def test_resource_markers_are_owned_by_context_markers_pass(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        context_owner_content = CONTEXT_PASS_ORCHESTRATOR_OWNER_JS.read_text(encoding="utf-8")
        imports = renderer_content.replace('"', "'")
        context_markers_body = context_owner_content.split(
            "function drawContextMarkersPass(k, { interactive = false } = {}) {",
            1,
        )[1].split(
            "\n  function drawContextScenarioPass",
            1,
        )[0]
        context_signature_body = (REPO_ROOT / "js/core/renderer/render_pass_signature_policy.js").read_text(encoding="utf-8").split(
            'if (passName === "contextMarkers") {',
            1,
        )[1].split(
            "\n  }",
            1,
        )[0]
        context_flag_signature_body = (REPO_ROOT / "js/core/renderer/visible_frame_identity_policy.js").read_text(encoding="utf-8").split(
            "function getVisibleContextFlagSignature() {",
            1,
        )[1].split(
            "\n  }\n\n  function countFeatureCollectionFeatures",
            1,
        )[0]

        self.assertIn(
            "import { buildStrategicResourceMarkerEntries } from './renderer/strategic_resource_markers.js';",
            imports,
        )
        self.assertIn(
            "import { isScenarioStrategicValuesUsable } from './scenario/strategic_values.js';",
            imports,
        )
        self.assertIn('"drawStrategicResourceMarkersLayer"', renderer_content)
        self.assertIn("function getStrategicResourceMarkerLayerState(k) {", renderer_content)
        self.assertIn("function drawStrategicResourceMarkersLayer(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("buildStrategicResourceMarkerEntries(payload, {", renderer_content)
        self.assertIn("!isScenarioStrategicValuesUsable(payload)", renderer_content)
        self.assertIn('"diagnostic-errors"', renderer_content)
        self.assertIn("drawStrategicResourceMarkersLayer(k, { interactive });", context_markers_body)
        self.assertIn('"drawStrategicResourceMarkersLayer",', context_markers_body)
        self.assertIn("createDeferredMetricPayload(snapshot.strategicResourceFeatureCount)", context_markers_body)
        self.assertIn(
            'runtimeState.showStrategicResourceMarkers ? "strategic-resources:on" : "strategic-resources:off"',
            context_signature_body,
        )
        self.assertIn(
            '`strategic-rev:${Number(runtimeState.scenarioStrategicValuesRevision || 0)}`',
            context_flag_signature_body,
        )
        self.assertIn(
            '`strategic-metric:${String(runtimeState.strategicChoroplethMetric || "")}`',
            context_flag_signature_body,
        )


if __name__ == "__main__":
    unittest.main()
