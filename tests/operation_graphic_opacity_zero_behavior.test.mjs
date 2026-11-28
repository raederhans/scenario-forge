import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOperationGraphicOpacity } from "../js/core/renderer/operation_graphic_geometry.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

test("updating a selected operation graphic preserves zero opacity", () => {
  const state = {
    operationGraphics: [{ id: "selected", opacity: 1, points: [[0, 0], [1, 1]] }],
    operationGraphicsEditor: { selectedId: "selected" },
  };
  const owner = createStrategicOverlayRuntimeOwner({ state, helpers: { normalizeOperationGraphicOpacity } });
  assert.equal(owner.updateSelectedOperationGraphic({ opacity: 0 }), true);
  assert.equal(state.operationGraphics[0].opacity, 0);
});
