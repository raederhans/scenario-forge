from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
RUNTIME_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime_owner.js"
HELPERS_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_helpers.js"
SPECIAL_ZONES_DOMAIN_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime" / "special_zones_runtime_domain.js"
OPERATION_GRAPHICS_DOMAIN_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime" / "operation_graphics_runtime_domain.js"
UNIT_COUNTER_DOMAIN_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime" / "unit_counter_runtime_domain.js"
UNIT_COUNTER_HELPERS_JS = REPO_ROOT / "js" / "core" / "renderer" / "strategic_overlay_runtime" / "unit_counter_runtime_helpers.js"


class MapRendererStrategicOverlayRuntimeOwnerBoundaryContractTest(unittest.TestCase):
    def test_map_renderer_keeps_facade_while_runtime_owner_takes_safe_transactions(self):
        renderer_content = MAP_RENDERER_JS.read_text(encoding="utf-8")
        owner_content = RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        special_zones_content = SPECIAL_ZONES_DOMAIN_JS.read_text(encoding="utf-8")
        operation_graphics_content = OPERATION_GRAPHICS_DOMAIN_JS.read_text(encoding="utf-8")
        unit_counter_domain_content = UNIT_COUNTER_DOMAIN_JS.read_text(encoding="utf-8")
        unit_counter_helpers_content = UNIT_COUNTER_HELPERS_JS.read_text(encoding="utf-8")
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
        self.assertIn("return getStrategicOverlayRuntimeOwner().appendOperationalLineVertexFromEvent(event);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().finishOperationalLineDraw();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().updateSelectedOperationalLine(partial);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().deleteSelectedOperationalLine();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().placeUnitCounterFromEvent(event);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().startUnitCounterPlacement({", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().cancelUnitCounterPlacement();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().selectUnitCounterById(id);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().updateSelectedUnitCounter(partial);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().deleteSelectedUnitCounter();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().cancelActiveStrategicInteractionModes();", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().getUnitCounterPreviewData(partialCounter);", renderer_content)
        self.assertIn("return getStrategicOverlayRuntimeOwner().resolveUnitCounterNationForPlacement(", renderer_content)
        self.assertNotIn('kind: "finish-operation-graphic"', renderer_content)
        self.assertNotIn('state.manualSpecialZones.features.push({', renderer_content)
        self.assertNotIn('kind: "create-operational-line"', renderer_content)
        self.assertNotIn('kind: "place-unit-counter"', renderer_content)

        self.assertIn("export function createStrategicOverlayRuntimeOwner({", owner_content)
        self.assertIn('createOperationGraphicsRuntimeDomain', owner_content)
        self.assertIn('createSpecialZonesRuntimeDomain', owner_content)
        self.assertIn('createUnitCounterRuntimeDomain', owner_content)
        self.assertIn('createUnitCounterRuntimeHelpers', owner_content)
        self.assertIn("function finishOperationalLineDraw() {", owner_content)
        self.assertIn("function updateSelectedOperationalLine(partial = {}) {", owner_content)
        self.assertIn("unitCounterDomain.syncOperationalLineAttachedCounterIds();", owner_content)
        self.assertIn("function cancelActiveStrategicInteractionModes() {", owner_content)
        self.assertIn("...unitCounterHelpers,", owner_content)
        self.assertIn("...unitCounterDomain,", owner_content)
        self.assertIn(
            "resolveUnitCounterNationForPlacement: unitCounterHelpers.resolveUnitCounterNationForPlacement,",
            owner_content,
        )
        self.assertNotIn("function syncOperationalLineAttachedCounterIds() {", owner_content)
        self.assertNotIn("function placeUnitCounterFromEvent(event) {", owner_content)
        self.assertNotIn("function startUnitCounterPlacement({", owner_content)
        self.assertNotIn("function cancelUnitCounterPlacement() {", owner_content)
        self.assertNotIn("function selectUnitCounterById(id) {", owner_content)
        self.assertNotIn("function updateSelectedUnitCounter(partial = {}) {", owner_content)
        self.assertNotIn("function deleteSelectedUnitCounter() {", owner_content)
        self.assertNotIn("function getUnitCounterPreviewData(partialCounter = {}) {", owner_content)
        self.assertNotIn("function resolveUnitCounterNationForPlacement(featureId = \"\", manualTag = \"\", preferredSource = \"display\") {", owner_content)
        self.assertIn("function finishOperationGraphicDraw() {", operation_graphics_content)
        self.assertIn("function updateSelectedOperationGraphic(partial = {}) {", operation_graphics_content)
        self.assertIn("function deleteSelectedOperationGraphicVertex() {", operation_graphics_content)
        self.assertIn("function finishSpecialZoneDraw() {", special_zones_content)
        self.assertIn("export function createUnitCounterRuntimeDomain({", unit_counter_domain_content)
        self.assertIn("function syncOperationalLineAttachedCounterIds() {", unit_counter_domain_content)
        self.assertIn("function placeUnitCounterFromEvent(event) {", unit_counter_domain_content)
        self.assertIn("function startUnitCounterPlacement({", unit_counter_domain_content)
        self.assertIn("function cancelUnitCounterPlacement() {", unit_counter_domain_content)
        self.assertIn("function selectUnitCounterById(id) {", unit_counter_domain_content)
        self.assertIn("function updateSelectedUnitCounter(partial = {}) {", unit_counter_domain_content)
        self.assertIn("function deleteSelectedUnitCounter() {", unit_counter_domain_content)
        self.assertIn("export function createUnitCounterRuntimeHelpers({", unit_counter_helpers_content)
        self.assertIn("function getUnitCounterPreviewData(partialCounter = {}) {", unit_counter_helpers_content)
        self.assertIn("function resolveUnitCounterNationForPlacement(featureId = \"\", manualTag = \"\", preferredSource = \"display\") {", unit_counter_helpers_content)

    def test_runtime_owner_stays_separate_from_draw_helpers_owner(self):
        owner_content = RUNTIME_OWNER_JS.read_text(encoding="utf-8")
        helpers_content = HELPERS_OWNER_JS.read_text(encoding="utf-8")
        unit_counter_domain_content = UNIT_COUNTER_DOMAIN_JS.read_text(encoding="utf-8")
        unit_counter_helpers_content = UNIT_COUNTER_HELPERS_JS.read_text(encoding="utf-8")

        self.assertNotIn("./strategic_overlay_helpers.js", owner_content)
        self.assertNotIn("./strategic_overlay_runtime_owner.js", helpers_content)
        self.assertNotIn("./strategic_overlay_helpers.js", unit_counter_domain_content)
        self.assertNotIn("./strategic_overlay_helpers.js", unit_counter_helpers_content)
        self.assertNotIn("./strategic_overlay_runtime_owner.js", unit_counter_domain_content)
        self.assertNotIn("./strategic_overlay_runtime_owner.js", unit_counter_helpers_content)


if __name__ == "__main__":
    unittest.main()
