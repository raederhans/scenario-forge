from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER = REPO_ROOT / "js" / "core" / "map_renderer.js"


class TnoReliefOverlayContractTest(unittest.TestCase):
    def test_atlantropa_salt_texture_uses_neutralized_style_guard(self):
        content = MAP_RENDERER.read_text(encoding="utf-8")
        self.assertIn('const RELIEF_ATLANTROPA_SALT_FILL_COLOR = "rgba(0, 0, 0, 0)";', content)
        self.assertIn('const RELIEF_ATLANTROPA_SALT_STROKE_COLOR = "rgba(148, 163, 184, 0.22)";', content)
        self.assertIn('const RELIEF_ATLANTROPA_SHORELINE_COLOR = "rgba(148, 163, 184, 0.36)";', content)
        self.assertIn('const RELIEF_ATLANTROPA_CONTOUR_COLOR = "rgba(148, 163, 184, 0.18)";', content)
        self.assertIn("function isAtlantropaReliefOverlayFeature(feature) {", content)
        self.assertIn('String(runtimeState.activeScenarioId || "").trim().toLowerCase() !== "tno_1962"', content)
        self.assertIn('startsWith("atlantropa_")', content)
        self.assertIn("if (isAtlantropaReliefOverlayFeature(feature)) {", content)
        self.assertIn("if (!runtimeState.detailPromotionCompleted) return false;", content)
        self.assertIn('if (String(runtimeState.topologyBundleMode || "").trim().toLowerCase() !== "composite") return false;', content)
        self.assertIn("const isAtlantropaRelief = isAtlantropaReliefOverlayFeature(feature);", content)
        self.assertIn("if (isAtlantropaRelief) {", content)
        self.assertIn("fill: RELIEF_ATLANTROPA_SALT_FILL_COLOR,", content)
        self.assertIn("stroke: RELIEF_ATLANTROPA_SALT_STROKE_COLOR,", content)
        self.assertIn("stroke: isAtlantropaRelief ? RELIEF_ATLANTROPA_SHORELINE_COLOR : RELIEF_SHORELINE_COLOR,", content)
        self.assertIn("stroke: isAtlantropaRelief ? RELIEF_ATLANTROPA_CONTOUR_COLOR : RELIEF_CONTOUR_COLOR,", content)

    def test_context_scenario_signature_tracks_detail_phase_for_cache_invalidation(self):
        content = MAP_RENDERER.read_text(encoding="utf-8")
        self.assertIn('String(runtimeState.topologyBundleMode || "single")', content)
        self.assertIn('runtimeState.detailPromotionCompleted ? "detail-ready" : "detail-pending"', content)
        self.assertIn('runtimeState.detailPromotionInFlight ? "detail-in-flight" : "detail-idle"', content)


if __name__ == "__main__":
    unittest.main()
