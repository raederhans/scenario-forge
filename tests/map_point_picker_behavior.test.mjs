import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { cancelMapPointPick, startMapPointPick, cancelActiveStrategicInteractionModes } from "../js/core/map_renderer/public.js";
import { isMapPointPickActive } from "../js/core/map_point_picker.js";
import { createClickSelectionTransactionOwner } from "../js/core/map_renderer/click_selection_transaction_owner.js";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";
import { createPhysicalIntensityPreviewOwner } from "../js/core/renderer/physical_intensity_preview_owner.js";
import { createBrushInteractionSessionOwner, isBrushPanGesture } from "../js/core/renderer/brush_interaction_session_owner.js";
import { initShortcuts } from "../js/ui/shortcuts.js";

test("a pick uses the inverse viewport projection and consumes the click and double-click", async t => {
  t.after(cancelMapPointPick);
  const rect = {};
  globalThis.d3 = {
    pointer(event, node) {
      assert.equal(node, rect);
      return [event.clientX, event.clientY];
    },
  };
  t.after(() => { delete globalThis.d3; });
  const { getMapLonLatFromEvent } = createPhysicalIntensityPreviewOwner({ zoomTransform: { x: 5, y: 7, k: 2 } }, {
    rendererSurfaceHost: {
      getInteractionRect: () => ({ node: () => rect }),
      getProjection: () => ({ invert: ([x, y]) => [x - 90, 90 - y] }),
    },
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  });
  let hit;
  let readonlyBlocks = 0;
  const ports = values => new Proxy(values, {
    get: (target, key) => target[key] ?? (() => assert.fail(`unexpected interaction: ${key}`)),
  });
  const click = createClickSelectionTransactionOwner({
    constants: { clickSnapRadiusPx: 5 },
    getters: { getClickState: () => state, getSelectedFacilityEntry: () => null },
    effects: ports({ consumeSuppressedBrushClick: () => false }),
    services: ports({
      blockStartupReadonlyInteraction: () => { readonlyBlocks++; },
      nowMs: () => 0,
      getMapLonLatFromEvent,
      getHitFromEvent: (_event, options) => {
        assert.equal(options.enableSnap, false);
        return hit;
      },
    }),
  });
  const readonlyPick = startMapPointPick({ purpose: "capital" });
  state.startupReadonly = true;
  state.currentTool = "select";
  await click.handleClick({ detail: 1 });
  assert.equal(readonlyBlocks, 1);
  assert.equal(isMapPointPickActive(state), true);
  state.startupReadonly = false;
  cancelMapPointPick();
  assert.equal(await readonlyPick, null);

  for (const currentTool of ["fill", "select"]) {
    state.currentTool = currentTool;
    for (hit of [{ targetType: "land", id: "A" }, { targetType: "water", id: "sea" }, {}]) {
      const picked = startMapPointPick({ purpose: "capital" });
      await click.handleClick({ detail: 1, clientX: 45, clientY: 87 });
      assert.deepEqual(await picked, { lon: -70, lat: 50, hostFeatureId: hit.targetType === "land" ? "A" : "" });
      await click.handleClick({ detail: 2 });
      await click.handleDoubleClickFill({ detail: 2 });
      assert.equal(isMapPointPickActive(state), false);
    }
  }
});

test("replacement, explicit cancellation and text placement settle the pending request", async () => {
  state.mapLabelEditor.active = true;
  state.strategicOverlayUi.modalOpen = true;
  const first = startMapPointPick({ purpose: "first" });
  assert.equal(state.mapLabelEditor.active, false);
  assert.equal(state.strategicOverlayUi.modalOpen, false);
  const second = startMapPointPick({ purpose: "second" });
  assert.equal(await first, null);
  assert.deepEqual(state.mapPointPicker, { active: true, purpose: "second" });
  assert.equal(cancelActiveStrategicInteractionModes(), true);
  state.mapLabelEditor.active = true;
  assert.equal(await second, null);
  const third = startMapPointPick({ purpose: "third" });
  assert.equal(state.mapLabelEditor.active, false);
  cancelMapPointPick();
  assert.equal(await third, null);
  assert.deepEqual(state.mapPointPicker, { active: false, purpose: "" });
});

test("Escape cancels the pick while preserving the underlying brush tool", async t => {
  const win = new EventTarget();
  globalThis.window = win;
  globalThis.document = { body: { dataset: {} } };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  initShortcuts();
  state.brushModeEnabled = true;
  const picked = startMapPointPick({ purpose: "capital" });
  const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
  win.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(await picked, null);
  assert.equal(state.brushModeEnabled, true);
});

test("mouse, pen and touch can navigate during a pick without starting a brush stroke", async () => {
  state.currentTool = "fill";
  state.brushModeEnabled = true;
  const picked = startMapPointPick({ purpose: "capital" });
  const brush = createBrushInteractionSessionOwner(state, {
    getBrushSession: () => null,
    setBrushSession: () => assert.fail("started brush stroke"),
  });
  for (const pointerType of ["mouse", "pen", "touch"]) {
    const event = { pointerType, buttons: 1, pointerId: 1, clientX: 10, clientY: 10 };
    assert.equal(isBrushPanGesture(state, event), true);
    brush.handleBrushPointerDown(event);
    brush.handleBrushPointerMove({ ...event, clientX: 30 });
    brush.handleBrushPointerEnd({ ...event, type: "pointerup" });
    assert.equal(isMapPointPickActive(state), true);
  }
  cancelMapPointPick();
  assert.equal(await picked, null);
});

test("the hover cursor stays a crosshair until the pick ends", async () => {
  const styles = [];
  const unusedPorts = new Proxy({}, { get: () => () => {} });
  const hover = createMapHoverInteractionOwner({
    state, getters: unusedPorts, effects: unusedPorts, helpers: unusedPorts,
    surfaceHost: { getInteractionRect: () => ({ style: (key, value) => styles.push([key, value]) }) },
  });
  const picked = startMapPointPick({ purpose: "capital" });
  hover.setMapInteractionCursor("pointer");
  cancelMapPointPick();
  hover.setMapInteractionCursor("pointer");
  assert.equal(await picked, null);
  assert.deepEqual(styles, [["cursor", "crosshair"], ["cursor", "pointer"]]);
});
