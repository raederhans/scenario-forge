import assert from "node:assert/strict";
import test from "node:test";

import { clearDirtyState, markDirtyState } from "../js/core/state/actions/ui_dirty_actions.js";

test("dirty actions keep revision monotonic and update reasons only when supplied", () => {
  const target = { isDirty: false, dirtyRevision: 4, lastDirtyReason: "initial" };

  assert.equal(markDirtyState(target, " first-edit "), 5);
  assert.equal(target.isDirty, true);
  assert.equal(target.lastDirtyReason, " first-edit ");
  assert.equal(markDirtyState(target), 6);
  assert.equal(target.lastDirtyReason, " first-edit ");

  assert.equal(clearDirtyState(target, " project-export "), false);
  assert.equal(target.dirtyRevision, 6);
  assert.equal(target.lastDirtyReason, " project-export ");
});

test("dirty actions fail closed for invalid targets", () => {
  assert.equal(markDirtyState(null, "edit"), 0);
  assert.equal(clearDirtyState(null, "save"), false);
});
