import test from "node:test";
import assert from "node:assert/strict";

import * as strategicOverlayActions from "../js/core/state/actions/strategic_overlay_actions.js";

const {
  commitStrategicOverlayCollectionsState,
  patchStrategicOverlayEditorState,
  restoreStrategicOverlaySnapshotState,
  setStrategicOverlayDirtyState,
} = strategicOverlayActions;

test("strategic overlay actions reject invalid targets and unknown authorities", () => {
  assert.throws(() => commitStrategicOverlayCollectionsState(null, {}), /target must be an object/);
  assert.throws(
    () => commitStrategicOverlayCollectionsState({}, { specialZoneLayers: [] }),
    /unknown collection key: specialZoneLayers/,
  );
  assert.throws(
    () => patchStrategicOverlayEditorState({}, "unknownEditor", {}),
    /unknown editor key: unknownEditor/,
  );
  assert.throws(
    () => setStrategicOverlayDirtyState({}, "specialZonesOverlayDirty"),
    /unknown dirty key: specialZonesOverlayDirty/,
  );
});

test("strategic collection commit is finite, cloned, and marks matching dirty fields", () => {
  const lines = [{ id: "line-1", points: [[1, 2]] }];
  const counters = [{ id: "counter-1" }];
  const target = {
    operationalLines: [],
    operationGraphics: [{ id: "kept" }],
    unitCounters: [],
    operationalLinesDirty: false,
    operationGraphicsDirty: false,
    unitCountersDirty: false,
  };

  const result = commitStrategicOverlayCollectionsState(target, {
    operationalLines: lines,
    unitCounters: counters,
  });

  assert.deepEqual(result.updatedKeys, ["operationalLines", "unitCounters"]);
  assert.deepEqual(target.operationalLines, lines);
  assert.notEqual(target.operationalLines, lines);
  assert.notEqual(target.operationalLines[0], lines[0]);
  assert.deepEqual(target.operationGraphics, [{ id: "kept" }]);
  assert.equal(target.operationalLinesDirty, true);
  assert.equal(target.operationGraphicsDirty, false);
  assert.equal(target.unitCountersDirty, true);
});

test("strategic default cloning preserves circular references without retaining caller aliases", () => {
  const attachment = { kind: "anchor" };
  attachment.self = attachment;
  const target = {
    unitCounters: [{ id: "counter-1", attachment: null }],
    unitCountersDirty: false,
  };

  strategicOverlayActions.patchStrategicOverlayEntityState(
    target,
    "unitCounters",
    "counter-1",
    { attachment },
  );

  const restored = target.unitCounters[0].attachment;
  assert.notEqual(restored, attachment);
  assert.equal(restored.self, restored);
  assert.equal(attachment.self, attachment);
});

test("strategic custom cloneValue receives the original prototype-bearing value", () => {
  class AttachmentPayload {
    constructor(kind) {
      this.kind = kind;
    }
  }
  const attachment = new AttachmentPayload("formation");
  const target = {
    unitCounters: [{ id: "counter-1", attachment: null }],
    unitCountersDirty: false,
  };
  let received = null;

  strategicOverlayActions.patchStrategicOverlayEntityState(
    target,
    "unitCounters",
    "counter-1",
    { attachment },
    {
      cloneValue(value) {
        received = value;
        return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
      },
    },
  );

  assert.equal(received, attachment);
  assert.equal(target.unitCounters[0].attachment instanceof AttachmentPayload, true);
  assert.notEqual(target.unitCounters[0].attachment, attachment);
});

test("strategic snapshot restore prepares every clone before one atomic commit", () => {
  const originalLines = [{ id: "old-line" }];
  const originalGraphics = [{ id: "old-graphic" }];
  const target = {
    operationalLines: originalLines,
    operationGraphics: originalGraphics,
    operationalLinesDirty: false,
    operationGraphicsDirty: false,
  };
  let calls = 0;

  assert.throws(() => restoreStrategicOverlaySnapshotState(target, {
    operationalLines: [{ id: "new-line" }],
    operationGraphics: [{ id: "new-graphic" }],
  }, {
    cloneValue(value) {
      calls += 1;
      if (calls === 2) throw new Error("clone failed");
      return structuredClone(value);
    },
  }), /clone failed/);

  assert.equal(target.operationalLines, originalLines);
  assert.equal(target.operationGraphics, originalGraphics);
  assert.equal(target.operationalLinesDirty, false);
  assert.equal(target.operationGraphicsDirty, false);
});

test("strategic editor patches accept only the editor's finite field set", () => {
  const points = [[10, 20]];
  const editor = {
    active: false,
    mode: "idle",
    points: [],
    kind: "frontline",
    label: "",
    stylePreset: "frontline",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  };
  const target = {
    operationalLineEditor: editor,
  };

  const next = patchStrategicOverlayEditorState(target, "operationalLineEditor", {
    active: true,
    points,
    selectedId: "line-1",
  });

  assert.equal(next, target.operationalLineEditor);
  assert.equal(next, editor);
  assert.equal(next.active, true);
  assert.deepEqual(next.points, [[10, 20]]);
  assert.notEqual(next.points, points);
  assert.notEqual(next.points[0], points[0]);
  assert.throws(
    () => patchStrategicOverlayEditorState(target, "operationalLineEditor", { modalOpen: true }),
    /unknown operationalLineEditor field: modalOpen/,
  );
});
test("strategic entity patches replace only the selected entity and clone changed values", () => {
  assert.equal(typeof strategicOverlayActions.patchStrategicOverlayEntityState, "function");
  const first = { id: "line-1", label: "First", points: [[0, 0]] };
  const second = { id: "line-2", label: "Second", points: [[1, 1]] };
  const nextPoints = [[2, 2], [3, 3]];
  const target = {
    operationalLines: [first, second],
    operationalLinesDirty: false,
  };
  const originalCollection = target.operationalLines;

  const result = strategicOverlayActions.patchStrategicOverlayEntityState(
    target,
    "operationalLines",
    "line-2",
    { label: "Updated", points: nextPoints },
  );

  assert.deepEqual(result, { changed: true, entityId: "line-2", collectionKey: "operationalLines" });
  assert.equal(Object.isFrozen(result), true);
  assert.notEqual(target.operationalLines, originalCollection);
  assert.equal(target.operationalLines[0], first);
  assert.notEqual(target.operationalLines[1], second);
  assert.equal(target.operationalLines[1].label, "Updated");
  assert.deepEqual(target.operationalLines[1].points, nextPoints);
  assert.notEqual(target.operationalLines[1].points, nextPoints);
  assert.notEqual(target.operationalLines[1].points[0], nextPoints[0]);
  assert.equal(target.operationalLinesDirty, true);
});

test("strategic entity group patches preserve untouched entries and reject unknown fields", () => {
  assert.equal(typeof strategicOverlayActions.patchStrategicOverlayEntityGroupState, "function");
  const first = { id: "line-1", attachedCounterIds: [] };
  const second = { id: "line-2", attachedCounterIds: ["unit-old"] };
  const target = {
    operationalLines: [first, second],
    operationalLinesDirty: false,
  };

  const result = strategicOverlayActions.patchStrategicOverlayEntityGroupState(
    target,
    "operationalLines",
    [{ entityId: "line-2", patch: { attachedCounterIds: ["unit-2"] } }],
    { markDirty: false },
  );

  assert.deepEqual(result, {
    changedEntityIds: ["line-2"],
    collectionKey: "operationalLines",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(target.operationalLines[0], first);
  assert.notEqual(target.operationalLines[1], second);
  assert.deepEqual(target.operationalLines[1].attachedCounterIds, ["unit-2"]);
  assert.equal(target.operationalLinesDirty, false);
  assert.throws(
    () => strategicOverlayActions.patchStrategicOverlayEntityState(
      target,
      "operationalLines",
      "line-1",
      { renderer: "milstd" },
    ),
    /unknown operationalLines entity field: renderer/,
  );
});
