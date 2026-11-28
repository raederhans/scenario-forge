import test from "node:test";
import assert from "node:assert/strict";
import { ensureSpecialZoneEditorState, restoreSpecialZoneSnapshotState } from "../js/core/state/actions/special_zone_actions.js";


test("special zone editor compatibility preserves valid legacy fields and fills missing fields", () => {
  const vertices = [[1, 2]];
  const target = {
    specialZoneEditor: {
      active: true,
      vertices,
      zoneType: "buffer",
      label: "Legacy",
      counter: "bad",
    },
  };

  const editor = ensureSpecialZoneEditorState(target);

  assert.equal(editor, target.specialZoneEditor);
  assert.equal(editor.active, true);
  assert.equal(editor.vertices, vertices);
  assert.equal(editor.zoneType, "buffer");
  assert.equal(editor.label, "Legacy");
  assert.equal(editor.counter, 1);
  assert.equal(editor.selectedId, null);
});

test("special zone snapshot restore detaches editor vertices from history snapshots", () => {
  const snapshot = {
    specialZoneEditor: {
      active: true,
      vertices: [[1, 2], [3, 4]],
      zoneType: "custom",
      label: "History",
      selectedId: "zone-1",
      counter: 2,
    },
  };
  const target = {};

  restoreSpecialZoneSnapshotState(target, snapshot);

  assert.notEqual(target.specialZoneEditor, snapshot.specialZoneEditor);
  assert.notEqual(target.specialZoneEditor.vertices, snapshot.specialZoneEditor.vertices);
  assert.notEqual(target.specialZoneEditor.vertices[0], snapshot.specialZoneEditor.vertices[0]);
  target.specialZoneEditor.vertices[0][0] = 99;
  snapshot.specialZoneEditor.vertices[1][0] = 77;
  assert.deepEqual(snapshot.specialZoneEditor.vertices[0], [1, 2]);
  assert.deepEqual(target.specialZoneEditor.vertices[1], [3, 4]);
});
