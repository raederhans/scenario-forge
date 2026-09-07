import assert from "node:assert/strict";
import test from "node:test";
import { createBrushInteractionSessionOwner, mergeHistorySnapshot } from "../js/core/renderer/brush_interaction_session_owner.js";

function harness() {
  let session = null;
  const calls = [];
  const state = { brushModeEnabled: true, currentTool: "fill", selectedColor: "#abcdef", landIndex: new Map([["a", {}]]) };
  const modes = { physical: false, special: false, changed: true, hit: { id: "a", targetType: "land" } };
  const record = (name) => (...args) => calls.push([name, ...args]);
  const owner = createBrushInteractionSessionOwner({
    runtimeState: state,
    getBrushSession: () => session,
    setBrushSession: (value) => { session = value; calls.push(["session", value]); },
    suppressNextClick: record("suppress"), getContext: () => ({}), nowMs: () => 10,
    captureHistoryState: (scope) => { assert.equal(session, null); calls.push(["capture", scope]); return { colors: { a: "new" } }; },
    pushHistoryEntry: record("history"), isSovereigntyModeActive: () => false,
    addRecentColor: record("recent"), markDirty: record("dirty"), refreshSidebarAfterPaint: record("sidebar"),
    requestRendererRender: record("render"), noteRenderAction: record("note"),
    getHitFromEvent: (_event, options) => { calls.push(["hit", options]); return modes.hit; },
    getStrategicOverlayRuntimeOwner: () => ({
      hasSpecialZoneMembershipDragSession: () => modes.special,
      beginSpecialZoneMembershipDrag: () => { calls.push(["special-start"]); modes.special = true; return true; },
      finishSpecialZoneMembershipDrag: () => { calls.push(["special-finish"]); modes.special = false; return { active: true }; },
      applySpecialZoneMembershipDragFeature: (id) => { calls.push(["special-hit", id]); return true; },
    }),
    getSpecialZoneMembershipTool: () => "brush", getSpecialZoneMembershipBrushMode: () => "add",
    blockStartupReadonlyInteraction: record("readonly"),
    handlePhysicalIntensityPointerDown: () => { calls.push(["physical-down"]); return modes.physical; },
    handlePhysicalIntensityPointerMove: () => { calls.push(["physical-move"]); return modes.physical; },
    isBrushNavigationModifier: (event) => !!event.ctrlKey,
    applyBrushHit: (hit) => {
      calls.push(["apply", hit]);
      if (modes.changed) { session.changed = true; session.affectedFeatureIds.add(hit.id); session.before = { colors: { a: "old" } }; }
      return modes.changed;
    },
    requestInteractionRender: record("preview"),
  });
  const event = (x = 0, buttons = 1) => ({ clientX: x, clientY: 0, buttons, preventDefault: record("prevent") });
  return { owner, state, calls, modes, event, getSession: () => session };
}

test("brush crosses drag threshold, previews changes and commits one ordered history transaction", () => {
  const h = harness();
  h.owner.handleBrushPointerDown(h.event());
  const original = h.getSession();
  h.owner.handleBrushPointerDown(h.event(100));
  assert.equal(h.getSession(), original);
  h.owner.handleBrushPointerMove(h.event(3));
  assert.equal(original.dragging, false);
  h.owner.handleBrushPointerMove(h.event(4));
  assert.equal(original.dragging, true);
  assert.ok(h.calls.some(([name, reason]) => name === "preview" && reason === "brush-preview"));
  h.calls.length = 0;
  h.owner.handleBrushPointerMove(h.event(4, 0));
  assert.deepEqual(h.calls.map(([name]) => name), ["physical-move", "session", "suppress", "capture", "history", "recent", "dirty", "sidebar", "render", "note"]);
  const history = h.calls.find(([name]) => name === "history")[1];
  assert.deepEqual(history, { kind: "brush-fill", before: { colors: { a: "old" } }, after: { colors: { a: "new" } }, meta: { affectsSovereignty: false } });
  assert.deepEqual(h.calls.find(([name]) => name === "render").slice(1), ["brush-stroke", { flush: true }]);
  h.calls.length = 0;
  h.owner.flushBrushSession();
  assert.deepEqual(h.calls, []);
});

test("click without dragging makes no transaction; unchanged drag still suppresses next click", () => {
  const h = harness();
  h.owner.handleBrushPointerDown(h.event());
  h.calls.length = 0;
  h.owner.flushBrushSession();
  assert.deepEqual(h.calls.map(([name]) => name), ["session"]);
  h.owner.handleBrushPointerDown(h.event());
  h.modes.changed = false;
  h.owner.handleBrushPointerMove(h.event(4));
  h.calls.length = 0;
  h.owner.flushBrushSession();
  assert.deepEqual(h.calls.map(([name]) => name), ["session", "suppress"]);
});

test("readonly, physical, and special membership take precedence over normal brush", () => {
  const h = harness();
  h.state.startupReadonly = true;
  h.owner.handleBrushPointerDown(h.event());
  h.owner.handleBrushPointerMove(h.event(4));
  assert.deepEqual(h.calls.map(([name]) => name), ["prevent", "readonly"]);
  h.state.startupReadonly = false;
  h.state.currentTool = "special-zone-membership";
  h.modes.physical = true;
  h.calls.length = 0;
  h.owner.handleBrushPointerDown(h.event());
  h.owner.handleBrushPointerMove(h.event(4));
  assert.deepEqual(h.calls.map(([name]) => name), ["physical-down", "physical-move"]);
  h.modes.physical = false;
  h.calls.length = 0;
  h.owner.handleBrushPointerDown(h.event());
  assert.deepEqual(h.calls.map(([name]) => name), ["physical-down", "special-start", "prevent", "hit", "special-hit"]);
  assert.equal(h.getSession(), null);
  h.calls.length = 0;
  h.owner.handleBrushPointerMove(h.event(4));
  assert.deepEqual(h.calls.map(([name]) => name), ["physical-move", "hit", "special-hit", "preview"]);
  h.calls.length = 0;
  h.owner.handleBrushPointerMove(h.event(4, 0));
  assert.deepEqual(h.calls.map(([name]) => name), ["physical-move", "special-finish", "suppress"]);
});

test("brush guards navigation, disabled state, eyedropper and special editor", () => {
  for (const setting of [{ brushModeEnabled: false }, { currentTool: "eyedropper" }, { specialZoneEditor: { active: true } }]) {
    const h = harness(); Object.assign(h.state, setting);
    h.owner.handleBrushPointerDown(h.event()); assert.equal(h.getSession(), null);
  }
  const h = harness(); h.owner.handleBrushPointerDown({ ...h.event(), ctrlKey: true });
  assert.equal(h.getSession(), null);
  h.owner.handleBrushPointerDown(h.event(0, 0)); assert.equal(h.getSession(), null);
});

test("history merge preserves unrelated sections and ignores invalid patches", () => {
  const target = { colors: { a: "old" }, owners: { a: "AA" } };
  mergeHistorySnapshot(target, null);
  mergeHistorySnapshot(target, { colors: { b: "old-b" }, owners: null, ignored: 0 });
  assert.deepEqual(target, { colors: { a: "old", b: "old-b" }, owners: { a: "AA" } });
});
