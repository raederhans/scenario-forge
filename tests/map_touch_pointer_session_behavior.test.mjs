import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMapInteractionEventBindingOwner } from "../js/core/renderer/map_interaction_event_binding_owner.js";
import { createBrushInteractionSessionOwner } from "../js/core/renderer/brush_interaction_session_owner.js";
import { state } from "../js/core/state.js";
import { captureHistoryState, clearHistory, pushHistoryEntry, undoHistory } from "../js/core/history_manager.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";
const d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");

function harness() {
  clearHistory();
  Object.assign(state, { brushModeEnabled: true, currentTool: "fill", selectedColor: "#abcdef",
    visualOverrides: {}, waterRegionOverrides: {}, startupReadonly: false });
  let session = null;
  const listeners = new Map(), windowListeners = new Map();
  const node = { style: {}, addEventListener: (type, fn) => listeners.set(type, fn) };
  const rect = { node: () => node, on: (type, fn) => { listeners.set(type, fn); return rect; } };
  const noop = () => {};
  const brush = createBrushInteractionSessionOwner(state, {
    getBrushSession: () => session, setBrushSession: value => { session = value; },
    suppressNextClick: noop, getContext: () => ({}), nowMs: () => 0,
    captureHistoryState, pushHistoryEntry, addRecentColor: noop, markDirty: noop,
    refreshSidebarAfterPaint: noop, requestRendererRender: noop, noteRenderAction: noop,
    cancelBrushPatchPreview: noop, refreshColorState: noop,
    getHitFromEvent: event => ({ id: event.region, targetType: "land" }),
    getStrategicOverlayRuntimeOwner: () => ({ hasSpecialZoneMembershipDragSession: () => false }),
    blockStartupReadonlyInteraction: noop, handlePhysicalIntensityPointerDown: () => false,
    handlePhysicalIntensityPointerMove: () => false,
    isBrushNavigationModifier: event => !!event.shiftKey,
    applyBrushHit: hit => {
      if (session.visitedFeatureIds.has(hit.id)) return false;
      Object.assign(session.before.visualOverrides ||= {}, captureHistoryState({ featureIds: [hit.id] }).visualOverrides);
      session.visitedFeatureIds.add(hit.id); session.affectedFeatureIds.add(hit.id);
      applyFeaturePaintState(state, [hit.id], state.selectedColor);
      session.changed = true;
      return true;
    }, requestInteractionRender: noop,
  });
  const owner = createMapInteractionEventBindingOwner({
    getters: { getInteractionRect: () => rect,
      getWindow: () => ({ addEventListener: (type, fn) => windowListeners.set(type, fn) }),
      isTouchBrushEnabled: () => state.brushModeEnabled },
    handlers: { ...brush, handleMouseMove: noop, handleMouseLeave: noop, mapClick: noop,
      mapDoubleClick: noop, handleResize: noop, handleSidebarLayoutStart: noop,
      handlePhysicalIntensityPointerDown: () => false, handlePhysicalIntensityPointerMove: () => false,
      handlePhysicalIntensityPointerEnd: () => false, cancelPhysicalIntensitySession: noop },
  });
  owner.bindEvents();
  const event = (pointerId = 1, region = "a", pointerType = "touch") => ({
    pointerId, pointerType, isPrimary: pointerId === 1, buttons: 1,
    clientX: { a: 0, b: 10, c: 20 }[region], clientY: 0, region, preventDefault: noop,
  });
  const down = e => listeners.get("pointerdown.fieldTool")?.({ ...e, type: "pointerdown" });
  const move = e => {
    listeners.get("pointermove.fieldTool")?.({ ...e, type: "pointermove" });
    windowListeners.get("pointermove")?.({ ...e, type: "pointermove" });
  };
  const end = (e, type = "pointerup") => windowListeners.get(type)?.({ ...e, type, buttons: 0 });
  return { owner, brush, node, event, down, move, end, getSession: () => session };
}

for (const pointerType of ["touch", "pen"]) {
  test(`${pointerType} stroke changes three regions and one undo restores the entire stroke`, () => {
    const h = harness();
    h.down(h.event(1, "a", pointerType));
    assert.ok(h.getSession(), "primary pointer starts brush session");
    assert.equal(h.owner.shouldAllowTouchNavigation(), false);
    h.move(h.event(1, "b", pointerType)); h.move(h.event(1, "c", pointerType));
    h.end(h.event(1, "c", pointerType));
    assert.deepEqual(state.visualOverrides, { a: "#abcdef", b: "#abcdef", c: "#abcdef" });
    assert.equal(state.historyPast.length, 1);
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById: () => null };
    try { assert.equal(undoHistory(), true); } finally { globalThis.document = previousDocument; }
    assert.deepEqual(state.visualOverrides, {});
    assert.equal(h.getSession(), null);
  });
}

test("second touch rolls back the stroke and keeps navigation until every finger leaves", () => {
  const h = harness();
  state.historyFuture = [{ kind: "existing-redo" }];
  h.down(h.event()); h.move(h.event(1, "b"));
  assert.equal(Object.keys(state.visualOverrides).length, 2);
  h.down(h.event(2));
  assert.deepEqual(state.visualOverrides, {});
  assert.equal(h.getSession(), null);
  assert.equal(h.owner.shouldAllowTouchNavigation(), true);
  h.move(h.event(1, "c")); h.end(h.event(2)); h.move(h.event(1, "b"));
  assert.equal(h.owner.shouldAllowTouchNavigation(), true);
  assert.deepEqual(state.visualOverrides, {});
  h.end(h.event());
  assert.equal(state.historyPast.length, 0);
  assert.deepEqual(state.historyFuture, [{ kind: "existing-redo" }]);
  h.down(h.event());
  assert.ok(h.getSession());
  h.end(h.event(), "pointercancel");
});

test("pointercancel restores paint, clears the session and permits a fresh stroke", () => {
  const h = harness();
  h.down(h.event()); h.move(h.event(1, "b")); h.end(h.event(), "pointercancel");
  assert.deepEqual(state.visualOverrides, {});
  assert.equal(h.getSession(), null);
  assert.equal(state.historyPast.length, 0);
  h.down(h.event()); h.end(h.event());
  assert.equal(state.historyPast.length, 1);
});

test("disabled brush leaves touch navigation and data unchanged", () => {
  const h = harness(); state.brushModeEnabled = false;
  h.down(h.event()); h.move(h.event(1, "b"));
  assert.equal(h.owner.shouldAllowTouchNavigation(), true);
  h.down(h.event(2));
  assert.equal(h.owner.shouldAllowTouchNavigation(), true);
  h.end(h.event(2)); h.end(h.event());
  assert.deepEqual(state.visualOverrides, {});
  assert.equal(state.historyPast.length, 0);
});

test("D3 rejects single-touch painting and takes over pinch navigation after rollback", () => {
  const h = harness();
  const listeners = new Map();
  const node = {
    style: { setProperty() {} }, clientLeft: 0, clientTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener() {},
  };
  const zoom = d3.zoom().touchable(true).extent([[0, 0], [100, 100]])
    .filter(() => h.owner.shouldAllowTouchNavigation());
  d3.select(node).call(zoom);
  const touch = (identifier, clientX) => ({ identifier, clientX, clientY: 0 });
  const dispatch = (type, touches, changedTouches = touches) => listeners.get(type).call(node, {
    type, touches, changedTouches, currentTarget: node,
    preventDefault() {}, stopImmediatePropagation() {},
  });
  h.down(h.event());
  dispatch("touchstart", [touch(1, 0)]);
  h.move(h.event(1, "b"));
  dispatch("touchmove", [touch(1, 10)]);
  assert.equal(node.__zoom.k, 1);
  assert.equal(node.__zoom.x, 0);
  h.down(h.event(2));
  dispatch("touchstart", [touch(1, 10), touch(2, 30)], [touch(2, 30)]);
  dispatch("touchmove", [touch(1, 0), touch(2, 40)]);
  assert.equal(node.__zoom.k, 2);
  assert.deepEqual(state.visualOverrides, {});
  assert.equal(state.historyPast.length, 0);
  h.end(h.event()); h.end(h.event(2));
  dispatch("touchend", [], [touch(1, 0), touch(2, 40)]);
});
