from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
STRATEGIC_OVERLAY_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_helpers.js"


class MapRendererStrategicOverlayHelpersBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_facade_while_owner_takes_strategic_overlay_draw_helpers(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = STRATEGIC_OVERLAY_HELPERS_JS.read_text(encoding="utf-8")
        renderer_imports = renderer_content.replace('"', "'")

        self.assertIn("import { createStrategicOverlayHelpersOwner } from './renderer/strategic_overlay_helpers.js';", renderer_imports)
        self.assertIn("let strategicOverlayHelpersOwner = null;", renderer_content)
        self.assertIn("function getStrategicOverlayHelpersOwner() {", renderer_content)
        self.assertIn("return getStrategicOverlayHelpersOwner().syncUnitCounterScalesDuringZoom();", renderer_content)
        self.assertIn("return getStrategicOverlayHelpersOwner().renderOperationalLinesOverlay();", renderer_content)
        self.assertIn("return getStrategicOverlayHelpersOwner().renderOperationGraphicsOverlay();", renderer_content)
        self.assertIn("getStrategicOverlayHelpersOwner().renderUnitCountersOverlay();", renderer_content)
        self.assertIn("bindUnitCounterOverlayInteractions();", renderer_content)
        self.assertIn("return getStrategicOverlayHelpersOwner().renderSpecialZones();", renderer_content)
        self.assertIn("renderOperationGraphicsEditorOverlay,", renderer_content)
        self.assertIn("updateSpecialZonesPaths,", renderer_content)
        self.assertIn("renderSpecialZoneEditorOverlay,", renderer_content)
        self.assertIn("syncUnitCounterScalesDuringZoom();", renderer_content)
        self.assertIn("renderFrontlineOverlayIfNeeded();", renderer_content)
        self.assertIn("renderOperationalLinesIfNeeded();", renderer_content)
        self.assertIn("renderOperationGraphicsIfNeeded();", renderer_content)
        self.assertIn("renderUnitCountersIfNeeded();", renderer_content)
        self.assertIn("renderSpecialZonesIfNeeded();", renderer_content)

        self.assertIn("export function createStrategicOverlayHelpersOwner({", owner_content)
        self.assertIn("function syncUnitCounterScalesDuringZoom() {", owner_content)
        self.assertIn("function renderOperationalLinesOverlay() {", owner_content)
        self.assertIn("function renderOperationGraphicsOverlay() {", owner_content)
        self.assertIn("function renderUnitCountersOverlay() {", owner_content)
        self.assertIn("function renderSpecialZones() {", owner_content)
        self.assertIn("const operationalLinesGroup = groupGetters.getOperationalLinesGroup?.() || null;", owner_content)
        self.assertIn("const operationGraphicsGroup = groupGetters.getOperationGraphicsGroup?.() || null;", owner_content)
        self.assertIn("const unitCountersGroup = groupGetters.getUnitCountersGroup?.() || null;", owner_content)
        self.assertIn("const specialZonesGroup = groupGetters.getSpecialZonesGroup?.() || null;", owner_content)
        self.assertIn("const specialZoneEditorGroup = groupGetters.getSpecialZoneEditorGroup?.() || null;", owner_content)

        self.assertIn('let lastSpecialZonesOverlaySignature = "";', renderer_content)
        self.assertIn('let lastOperationalLinesOverlaySignature = "";', renderer_content)
        self.assertIn('let lastOperationGraphicsOverlaySignature = "";', renderer_content)
        self.assertIn('let lastUnitCountersOverlaySignature = "";', renderer_content)
        self.assertIn("function getSpecialZonesOverlaySignature() {", renderer_content)
        self.assertIn("function getOperationGraphicsOverlaySignature() {", renderer_content)
        self.assertIn("function getOperationalLinesOverlaySignature() {", renderer_content)
        self.assertIn("function getUnitCountersOverlaySignature() {", renderer_content)
        self.assertIn("function renderSpecialZonesIfNeeded({ force = false } = {}) {", renderer_content)
        self.assertIn("function renderOperationGraphicsIfNeeded({ force = false } = {}) {", renderer_content)
        self.assertIn("function renderOperationalLinesIfNeeded({ force = false } = {}) {", renderer_content)
        self.assertIn("function renderUnitCountersIfNeeded({ force = false } = {}) {", renderer_content)
        self.assertNotIn('const groups = operationalLinesGroup', renderer_content)
        self.assertNotIn('const groups = operationGraphicsGroup', renderer_content)
        self.assertNotIn('const groups = unitCountersGroup', renderer_content)
        self.assertIn("function bindUnitCounterOverlayInteractions() {", renderer_content)
        self.assertIn("pushHistoryEntry({", renderer_content)
        self.assertIn('markDirty("move-unit-counter");', renderer_content)
        self.assertIn('renderUnitCountersIfNeeded({ force: true });', renderer_content)
        self.assertNotIn("pushHistoryEntry({", owner_content)
        self.assertNotIn('markDirty("move-unit-counter");', owner_content)
        self.assertNotIn('renderUnitCountersIfNeeded({ force: true });', owner_content)


if __name__ == "__main__":
    unittest.main()

