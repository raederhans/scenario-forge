import test from "node:test";
import assert from "node:assert/strict";
import * as strategicOverlayActions from "../js/core/state/actions/strategic_overlay_actions.js";

const {
  restoreStrategicOverlaySnapshotState,
} = strategicOverlayActions;

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
