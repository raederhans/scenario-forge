import test from "node:test";
import assert from "node:assert/strict";
import { createStrategicOverlayRuntimeOwner } from "../js/core/renderer/strategic_overlay_runtime_owner.js";

test("operation graphic runtime owner commits midpoint insertion", () => {
  const runtimeState = {
    operationGraphics: [{
      id: "opg_1",
      kind: "offensive",
      points: [[0, 0], [2, 0]],
    }],
    operationGraphicsDirty: false,
    operationGraphicsEditor: {
      active: false,
      mode: "edit",
      points: [[0, 0], [2, 0]],
      selectedId: "opg_1",
      selectedVertexIndex: -1,
    },
  };

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      ensureOperationGraphicsEditorState: () => {},
      getOperationGraphicById: (id) => runtimeState.operationGraphics.find((entry) => entry.id === id) || null,
    },
  });

  assert.equal(owner.insertOperationGraphicVertex(1, [1, 0]), true);
  assert.deepEqual(runtimeState.operationGraphics[0].points, [[0, 0], [1, 0], [2, 0]]);
});

test("unit counter runtime owner commits drag moves and detaches line attachments", () => {
  const runtimeState = {
    operationalLines: [{
      id: "opl_1",
      attachedCounterIds: ["unit_1"],
    }],
    operationalLinesDirty: false,
    unitCounters: [{
      id: "unit_1",
      anchor: { lon: 12, lat: 48, featureId: "GER" },
      attachment: { kind: "operational-line", lineId: "opl_1" },
      layoutAnchor: { kind: "attachment", key: "opl_1", slotIndex: 0 },
    }],
    unitCounterEditor: {},
    unitCountersDirty: false,
  };
  const counter = runtimeState.unitCounters[0];

  const owner = createStrategicOverlayRuntimeOwner({
    state: runtimeState,
    helpers: {
      ensureUnitCounterEditorState: () => {},
    },
  });

  assert.equal(owner.beginUnitCounterDrag(counter), true);
  assert.equal(owner.moveUnitCounterDrag(counter, [14.5, 49.25]), true);
  assert.equal(counter.attachment, null);
  assert.equal(counter.layoutAnchor.kind, "feature");
  assert.equal(counter.anchor.lon, 14.5);
  assert.equal(counter.anchor.lat, 49.25);
  assert.equal(owner.finishUnitCounterDrag(counter, { featureId: "POL" }), true);
  assert.equal(counter.anchor.featureId, "POL");
  assert.equal(counter.layoutAnchor.key, "POL");
  assert.deepEqual(runtimeState.operationalLines[0].attachedCounterIds, []);
});
