import assert from "node:assert/strict";
import test from "node:test";
import { createClickSelectionTransactionOwner, createPickedColorHandler } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { getHistoryActionLabel } from "../js/core/history_action_labels.js";
import { state as appState } from "../js/core/state.js";

function gestureHarness(currentTool, previousTool, granularity = "subdivision", targetType = "land") {
  const id = "a";
  const regions = new Map([[id, {}]]);
  const state = {
    currentTool, eyedropperPreviousTool: previousTool, interactionGranularity: granularity,
    selectedColor: "#000000", landData: {}, landIndex: regions, waterRegionsById: regions,
  };
  const writes = [];
  const pick = createPickedColorHandler(state, {
    selectTool: tool => { state.currentTool = tool; },
    notifyPicked: () => {},
  });
  const ports = values => new Proxy(values, { get: (target, key) => target[key] ?? (() => {}) });
  const owner = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 5 },
    getters: { getClickState: () => state, getSelectedFacilityEntry: () => null },
    effects: ports({
      setClickSelectedColor: pick,
      removeClickWaterRegionOverride: () => writes.push("erase water"),
    }),
    services: ports({
      getIntensityFieldTool: () => ({}),
      getHitFromEvent: () => ({ targetType, id }),
      getFeaturePaintColor: () => "#123456",
      getWaterRegionColor: () => "#234567",
      getSafeCanvasColor: value => value,
      ensureLeafDetailReady: () => true,
      isMacroOceanWaterRegion: () => true,
      isOpenOceanPaintEnabled: () => false,
      isDoubleClickBatchEligible: () => true,
      resolveInteractionTargetIds: () => [id],
      applyVisualSubdivisionFill: () => writes.push("fill"),
      commitVisualFeaturePaint: () => writes.push("erase"),
      fillFromDoubleClick: () => writes.push("batch"),
    }),
  });
  return { owner, state, writes };
}

test("a double-click that restores the previous tool only samples color", async () => {
  for (const [tool, granularity] of [["eraser", "subdivision"], ["fill", "country"], ["fill", "subdivision"]]) {
    const { owner, state, writes } = gestureHarness("eyedropper", tool, granularity);
    await owner.handleClick({ detail: 1 });
    assert.equal(state.selectedColor, "#123456");
    assert.equal(state.currentTool, tool);
    await owner.handleClick({ detail: 2 });
    await owner.handleDoubleClickFill({ detail: 2 });
    assert.deepEqual(writes, []);
    await owner.handleClick({ detail: 1 });
    assert.deepEqual(writes, [tool === "fill" ? "fill" : "erase"]);
  }
});

test("Alt double-click samples color and the next plain double-click still fills", async () => {
  const { owner, state, writes } = gestureHarness("fill");
  await owner.handleClick({ detail: 1, altKey: true });
  await owner.handleClick({ detail: 2, altKey: true });
  await owner.handleDoubleClickFill({ detail: 2, altKey: true });
  assert.equal(state.selectedColor, "#123456");
  assert.deepEqual(writes, []);
  await owner.handleClick({ detail: 1 });
  await owner.handleClick({ detail: 2 });
  await owner.handleDoubleClickFill({ detail: 2 });
  assert.deepEqual(writes, ["fill", "batch"]);
});

test("a selection-only ocean ignores eyedropper and Alt picks", async () => {
  for (const tool of ["eyedropper", "fill", "eraser"]) {
    const { owner, state, writes } = gestureHarness(tool, "fill", "subdivision", "water");
    await owner.handleClick({ detail: 1, altKey: tool !== "eyedropper" });
    assert.equal(state.selectedColor, "#000000");
    assert.equal(state.currentTool, tool);
    assert.deepEqual(writes, []);
  }
});

test("brush labels count changed water regions and river cells in their own namespaces", () => {
  appState.currentLanguage = "en";
  const changed = { a: "#123456", b: "#abcdef" };
  const original = { b: "#abcdef" };
  for (const fields of [["waterRegionOverrides"], ["riverPaintOverrides"],
    ["visualOverrides", "waterRegionOverrides", "riverPaintOverrides"]]) {
    const before = Object.fromEntries(fields.map(field => [field, original]));
    const after = Object.fromEntries(fields.map(field => [field, changed]));
    const regions = fields.length === 1 ? "1 region" : "3 regions";
    assert.equal(getHistoryActionLabel("Undo", { kind: "brush-fill", before, after }), `Undo: Paint ${regions}`);
    assert.equal(getHistoryActionLabel("Redo", { kind: "brush-erase", before: after, after: before }),
      `Redo: Erase paint from ${regions}`);
  }
});
