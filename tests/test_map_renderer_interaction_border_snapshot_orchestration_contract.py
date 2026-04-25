from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"


class MapRendererInteractionBorderSnapshotOrchestrationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")

    def test_borders_invalidation_still_invalidates_interaction_snapshot(self):
        self.assertIn('if (targetPassNames.includes("borders")) {', self.renderer_content)
        self.assertIn('invalidateInteractionBorderSnapshot(reason);', self.renderer_content)

    def test_clear_reference_transform_for_borders_still_invalidates_snapshot(self):
        self.assertIn('invalidateInteractionBorderSnapshot("clear-reference-transform");', self.renderer_content)
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'if \(targetPassNames\.includes\("borders"\)\) \{\s*invalidateInteractionBorderSnapshot\("clear-reference-transform"\);',
                re.S,
            ),
        )

    def test_transformed_frame_still_prefers_snapshot_before_border_pass_fallback(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'if \(!drawInteractionBorderSnapshot\(currentTransform\)\) \{\s*const k = Math\.max\(0\.0001, Number\(currentTransform\?\.k \|\| 1\)\);\s*context\.setTransform\(runtimeState\.dpr, 0, 0, runtimeState\.dpr, 0, 0\);\s*context\.translate\(currentTransform\.x, currentTransform\.y\);\s*context\.scale\(k, k\);\s*drawBordersPass\(k, \{ interactive: !!interactiveBorders \}\);',
                re.S,
            ),
        )

    def test_zoom_start_still_captures_interaction_border_snapshot(self):
        self.assertRegex(
            self.renderer_content,
            re.compile(
                r'\.on\("start", \(\) => \{[\s\S]*?captureInteractionBorderSnapshot\(runtimeState\.zoomTransform \|\| globalThis\.d3\.zoomIdentity\);',
                re.S,
            ),
        )


if __name__ == "__main__":
    unittest.main()
