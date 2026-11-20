import assert from "node:assert/strict";
import test from "node:test";
import {
  createClickSelectionTransactionOwner,
  createPickedColorHandler,
} from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { createBrushInteractionSessionOwner } from "../js/core/renderer/brush_interaction_session_owner.js";

const colors = { land: "#123456", water: "#234567", special: "#345678" };

function clickHarness(currentTool, targetType, previousTool, color = colors[targetType]) {
  const id = "region";
  const regions = new Map([[id, {}]]);
  const state = {
    currentTool, eyedropperPreviousTool: previousTool, selectedColor: "#000000",
    landData: {}, landIndex: regions, waterRegionsById: regions, specialRegionsById: regions,
  };
  let notifications = 0;
  const pick = createPickedColorHandler(state, {
    selectTool: tool => { state.currentTool = tool; },
    notifyPicked: () => { notifications++; },
  });
  const writes = [];
  const record = name => () => writes.push(name);
  const ports = overrides => new Proxy(overrides, { get: (target, key) => target[key] ?? (() => {}) });
  const owner = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 5 },
    getters: { getClickState: () => state, getSelectedFacilityEntry: () => null },
    effects: ports({
      setClickSelectedColor: (value, options) => {
        assert.equal(options.updateSwatch, true);
        pick(value);
      },
      removeClickWaterRegionOverride: record("erase water"),
    }),
    services: ports({
      getIntensityFieldTool: () => ({}),
      getHitFromEvent: () => ({ targetType, id }),
      ensureLeafDetailReady: () => true,
      getSafeCanvasColor: value => value,
      getFeaturePaintColor: () => color,
      getSpecialRegionColor: () => color,
      getWaterRegionColor: () => color,
      isMacroOceanWaterRegion: () => false,
      resolveInteractionTargetIds: () => [id],
      commitHistoryEntry: record("history"),
      commitVisualFeaturePaint: record("erase land"),
      applyVisualSubdivisionFill: record("fill land"),
      applyWaterRegionFill: record("fill water"),
    }),
  });
  return { owner, state, writes, notifications: () => notifications };
}

for (const target of Object.keys(colors)) {
  for (const tool of ["fill", "eraser"]) {
    test(`Alt+${tool} samples ${target} without painting or switching tools`, async () => {
      const h = clickHarness(tool, target);
      await h.owner.handleClick({ altKey: true });
      assert.equal(h.state.selectedColor, colors[target]);
      assert.equal(h.state.currentTool, tool);
      assert.equal(h.notifications(), 0);
      assert.deepEqual(h.writes, []);
    });
  }
  test(`successful eyedropper on ${target} restores the recorded tool or fill`, async () => {
    for (const previous of ["eraser", "select", undefined]) {
      const h = clickHarness("eyedropper", target, previous);
      await h.owner.handleClick({});
      assert.equal(h.state.selectedColor, colors[target]);
      assert.equal(h.state.currentTool, previous || "fill");
      assert.equal(h.notifications(), 1);
      assert.deepEqual(h.writes, []);
    }
  });
}

test("unsuccessful eyedropper leaves the tool active and gives no feedback", async () => {
  const h = clickHarness("eyedropper", "special", "eraser", null);
  await h.owner.handleClick({});
  assert.equal(h.state.currentTool, "eyedropper");
  assert.equal(h.notifications(), 0);
});

test("Alt pointerdown skips the paint stroke and still reaches membership removal", () => {
  for (const currentTool of ["fill", "eraser", "special-zone-membership"]) {
    const membership = [];
    const owner = createBrushInteractionSessionOwner({ currentTool, brushModeEnabled: true }, {
      getBrushSession: () => null,
      setBrushSession: () => assert.fail("started a paint stroke"),
      handlePhysicalIntensityPointerDown: () => false,
      isBrushNavigationModifier: () => false,
      getSpecialZoneMembershipTool: () => "click",
      getSpecialZoneMembershipBrushMode: () => "add",
      getStrategicOverlayRuntimeOwner: () => ({
        beginSpecialZoneMembershipDrag: ({ altKey }) => { membership.push(altKey); },
      }),
    });
    owner.handleBrushPointerDown({ altKey: true, buttons: 1, pointerType: "pen" });
    assert.deepEqual(membership, currentTool === "special-zone-membership" ? [true] : []);
  }
});
