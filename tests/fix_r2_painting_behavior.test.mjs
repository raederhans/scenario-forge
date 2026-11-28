import assert from "node:assert/strict";
import test from "node:test";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createRiverPaintEditorOwner } from "../js/core/river_paint/editor_owner.js";
import { captureCells, makeFixture } from "./helpers/river_paint_fixture.mjs";

const noop = () => {};

test("only-unpainted protects a parent with a painted river cell from brush and quick fill", async () => {
  const { state, parent, cells } = await makeFixture();
  state.onlyUnpainted = true;
  state.riverPaint.editMode = false;
  state.riverPaint.overrides[cells[0].id] = "#ff0000";
  const policy = createFillTargetPolicy(state, {
    getColorAdjacency: () => null, getFeaturePaintColor: () => "#cccccc",
    getVisibleFeatureIds: () => ["P", "N"], shouldExcludePoliticalInteractionFeature: () => false,
  });
  assert.deepEqual(policy.unprotectedIds(["P", "N"]), ["N"]);
  const plan = policy.buildDoubleClickBatchPlan(parent, "P", "color");
  assert.deepEqual(plan.targetIds, ["N"]);
  assert.equal(plan.skippedCount, 1);
});

test("river clicks and strokes skip painted cells, while fresh cells and erasing remain editable", async () => {
  const { state, pack, hit, cells } = await makeFixture();
  state.onlyUnpainted = true;
  const history = [];
  const editor = createRiverPaintEditorOwner({ state, captureHistoryState: captureCells(state),
    commitHistoryEntry: entry => history.push(entry), refreshParents: noop, markDirty: noop, addRecentColor: noop });
  const bank = i => ({ ...hit, riverPackId: pack.packId, riverCellId: cells[i].id });
  state.riverPaint.overrides[cells[0].id] = "#ff0000";
  assert.equal(editor.handleClick(bank(0)), true);
  assert.equal(state.riverPaint.overrides[cells[0].id], "#ff0000");
  const session = { before: {} };
  assert.deepEqual(editor.handleBrush(bank(0), session), { consumed: true, changed: false });
  assert.equal(history.length, 0);
  assert.equal(editor.handleBrush(bank(1), session).changed, true);
  assert.equal(state.riverPaint.overrides[cells[1].id], state.selectedColor);
  state.currentTool = "eraser";
  editor.handleClick(bank(0));
  assert.equal(Object.hasOwn(state.riverPaint.overrides, cells[0].id), false);
  assert.equal(history.length, 1);
});
