from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
BORDER_DRAW_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "border_draw_owner.js"


class MapRendererBorderDrawOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_border_pass_owner_while_draw_helpers_move_to_owner(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = BORDER_DRAW_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn(
            "import { createBorderDrawOwner } from './renderer/border_draw_owner.js';",
            renderer_imports,
        )
        self.assertIn("let borderDrawOwner = null;", renderer_content)
        self.assertIn("function getBorderDrawOwner() {", renderer_content)
        self.assertIn("getContext: () => context,", renderer_content)
        self.assertIn("getPathCanvas: () => pathCanvas,", renderer_content)
        self.assertIn("getProjection: () => projection,", renderer_content)
        self.assertIn("clamp,", renderer_content)
        self.assertIn("isUsableMesh,", renderer_content)
        self.assertIn("sanitizePolyline,", renderer_content)
        self.assertIn("const drawMeshCollection = (...args) => getBorderDrawOwner().drawMeshCollection(...args);", renderer_content)
        self.assertIn("const declutterProjectedPolyline = (...args) => getBorderDrawOwner().declutterProjectedPolyline(...args);", renderer_content)
        self.assertIn("const getProjectedPolylineMetrics = (...args) => getBorderDrawOwner().getProjectedPolylineMetrics(...args);", renderer_content)
        self.assertIn("const buildRenderableBoundaryMesh = (...args) => getBorderDrawOwner().buildRenderableBoundaryMesh(...args);", renderer_content)
        self.assertIn("getBorderDrawOwner().getViewportAwareCoastlineCollection(...args);", renderer_content)
        self.assertIn("const getBoundaryMeshTransform = (...args) => getBorderDrawOwner().getBoundaryMeshTransform(...args);", renderer_content)
        self.assertIn("return getBorderDrawOwner().drawHierarchicalBorders(k, { interactive });", renderer_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", renderer_content)
        self.assertIn("function drawBordersPass(k, { interactive = false } = {}) {", renderer_content)

        self.assertIn("export function createBorderDrawOwner({", owner_content)
        self.assertIn("state,", owner_content)
        self.assertIn("getDetailAdmMeshBuildState = () => ({ signature: \"\", status: \"idle\" }),", owner_content)
        self.assertIn("getScenarioOwnerOnlyCanonicalFallbackWarnings = () => new Set(),", owner_content)
        self.assertIn("function drawMeshCollection(meshCollection, strokeStyle, lineWidth, options = {}) {", owner_content)
        self.assertIn("function declutterProjectedPolyline(line, minDistancePx, angleThresholdDeg) {", owner_content)
        self.assertIn("function getProjectedPolylineMetrics(line) {", owner_content)
        self.assertIn("function buildRenderableBoundaryMesh(mesh, {", owner_content)
        self.assertIn("function getViewportAwareCoastlineCollection(collection, k) {", owner_content)
        self.assertIn("function getBoundaryMeshTransform(kind, k) {", owner_content)
        self.assertIn("function drawHierarchicalBorders(k, { interactive = false } = {}) {", owner_content)


if __name__ == "__main__":
    unittest.main()
