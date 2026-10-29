import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOperationGraphicOpacity } from "../js/core/renderer/operation_graphic_geometry.js";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

for (const [input, expected] of [[0, 0], [0.5, 0.5], [1.5, 1], [-0.5, 0], ["abc", 1], [undefined, 1], [null, 1], ["", 1], ["0", 0], [Infinity, 1], [-Infinity, 1]]) {
  test(`operation graphic opacity ${String(input)} normalizes to ${expected}`, () => {
    assert.equal(normalizeOperationGraphicOpacity(input), expected);
  });
}

for (const [collection, editor, update] of [
  ["operationGraphics", "operationGraphicsEditor", "updateSelectedOperationGraphic"],
  ["operationalLines", "operationalLineEditor", "updateSelectedOperationalLine"],
]) {
  test(`${update} preserves zero opacity`, () => {
    const state = {
      [collection]: [{ id: "selected", opacity: 1, points: [[0, 0], [1, 1]] }],
      [editor]: { selectedId: "selected" },
      operationGraphicsEditor: { selectedId: "selected" },
    };
    const owner = createStrategicOverlayRuntimeOwner({
      state,
      helpers: {
        normalizeOperationGraphicOpacity,
        getOperationalLineById: (id) => state.operationalLines.find((line) => line.id === id),
      },
    });
    assert.equal(owner[update]({ opacity: 0 }), true);
    assert.equal(state[collection][0].opacity, 0);
    if (collection === "operationalLines") assert.equal(state[editor].opacity, 0);
  });
}
