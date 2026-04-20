from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime_owner.js"
HELPERS_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_helpers.js"


class MapRendererStrategicOverlayRuntimeOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_facade_while_runtime_owner_takes_safe_transactions(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createStrategicOverlayRuntimeOwner } from './renderer/strategic_overlay_runtime_owner.js';", renderer_imports)
        self.assertIn("let strategicOverlayRuntimeOwner = null;", renderer_content)
        self.assertIn("function getStrategicOverlayRuntimeOwner() {", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().appendSpecialZoneVertexFromEvent(event);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().startSpecialZoneDraw({ zoneType, label });", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().finishSpecialZoneDraw();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().appendOperationGraphicVertexFromEvent(event);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().finishOperationGraphicDraw();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().updateSelectedOperationGraphic(partial);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().deleteSelectedOperationGraphicVertex();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().getUnitCounterPreviewData(partialCounter);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().resolveUnitCounterNationForPlacement(", renderer_content)
        self.assertNotIn('kind: "finish-operation-graphic"', renderer_content)
        self.assertNotIn('state.manualSpecialZones.features.push({', renderer_content)

        self.assertIn("export function createStrategicOverlayRuntimeOwner({", owner_content)
        self.assertIn("function finishOperationGraphicDraw() {", owner_content)
        self.assertIn("function updateSelectedOperationGraphic(partial = {}) {", owner_content)
        self.assertIn("function deleteSelectedOperationGraphicVertex() {", owner_content)
        self.assertIn("function finishSpecialZoneDraw() {", owner_content)
        self.assertIn("function getUnitCounterPreviewData(partialCounter = {}) {", owner_content)
        self.assertIn("function resolveUnitCounterNationForPlacement(featureId = \"\", manualTag = \"\", preferredSource = \"display\") {", owner_content)

    def test_runtime_owner_stays_separate_from_draw_helpers_owner(self):
        owner_content = RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        helpers_content = HELPERS_OWNER_JS.read_text(encoding="utf-8")

        self.assertNotIn("./strategic_overlay_helpers.js", owner_content)
        self.assertNotIn("./strategic_overlay_runtime_owner.js", helpers_content)


if __name__ == "__main__":
    unittest.main()
