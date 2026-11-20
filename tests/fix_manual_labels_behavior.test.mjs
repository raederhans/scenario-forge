import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
import { createBrushInteractionSessionOwner } from "../js/core/renderer/brush_interaction_session_owner.js";
import { renderMapLabelHandles } from "../js/core/renderer/map_label_handles_owner.js";
import { placeMapLabel } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";

class SvgNode extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  attrs = {};
  setAttribute(key, value) { this.attrs[key] = String(value); }
  appendChild(child) { this.children.push(child); child.parentNode = this; }
  remove() { this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

for (const [gesture, dx, dy] of [["drag", 10, -6], ["jitter", 2, 1]]) {
  test(`off-center label ${gesture} preserves the grab offset and records only a drag`, () => {
    const group = new SvgNode();
    group.ownerDocument = Object.assign(new EventTarget(), { createElementNS: () => new SvgNode() });
    state.mapLabels = [];
    state.zoomTransform = { x: 0, y: 0, k: 2 };
    const id = placeMapLabel({ lon: 20, lat: 30, text: "Long country name" });
    state.mapLabelEditor.selectedId = null;
    const before = state.historyPast.length;
    const projection = ([lon, lat]) => [2 * lon, 2 * lat];
    projection.invert = ([x, y]) => [x / 2, y / 2];
    renderMapLabelHandles({
      group, state, k: 2, projection, pointer: e => [e.clientX / 2, e.clientY / 2],
      placed: [{ id, bounds: { x: 5, y: 110, w: 150, h: 20 } }],
    });
    const rect = group.children[0];
    const event = (type, x, y) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y });
    rect.onpointerdown(event("pointerdown", 150, 116));
    rect.dispatchEvent(event("pointermove", 150 + dx, 116 + dy));
    const preview = group.children[1].attrs.transform;
    rect.dispatchEvent(event("pointerup", 150 + dx, 116 + dy));
    const { lon, lat } = state.mapLabels[0];
    assert.deepEqual([lon, lat], gesture === "drag" ? [22.5, 28.5] : [20, 30]);
    assert.equal(preview, gesture === "drag" ? "translate(45 57) rotate(0)" : "translate(40 60) rotate(0)");
    assert.equal(state.mapLabelEditor.selectedId, id);
    assert.deepEqual(state.historyPast.slice(before).map(entry => entry.kind), gesture === "drag" ? ["move-map-label"] : []);
  });
}

test("label placement keeps touch, pen and mouse gestures available for the placement click", () => {
  const editor = { active: true };
  let session = null;
  const brush = createBrushInteractionSessionOwner({ brushModeEnabled: true, currentTool: "fill", mapLabelEditor: editor }, {
    getBrushSession: () => session,
    setBrushSession: value => { session = value; },
    handlePhysicalIntensityPointerDown: () => false,
    handlePhysicalIntensityPointerMove: () => false,
    getStrategicOverlayRuntimeOwner: () => ({ hasSpecialZoneMembershipDragSession: () => false }),
    isBrushNavigationModifier: () => false,
    getHitFromEvent: () => ({ id: "land" }),
    applyBrushHit: () => assert.fail("placement painted land"),
    suppressNextClick: () => assert.fail("placement click was suppressed"),
    nowMs: () => 0,
  });
  for (const pointerType of ["touch", "pen", "mouse"]) {
    const down = { pointerType, pointerId: 1, buttons: 1, clientX: 10, clientY: 10 };
    brush.handleBrushPointerDown(down);
    assert.equal(session, null);
    brush.handleBrushPointerMove({ ...down, clientX: 20 });
    brush.handleBrushPointerEnd({ ...down, type: "pointerup", buttons: 0 });
  }
  editor.active = false;
  const mouse = { pointerType: "mouse", pointerId: 1, buttons: 1, clientX: 10, clientY: 10 };
  brush.handleBrushPointerDown(mouse);
  assert.ok(session);
  editor.active = true;
  brush.handleBrushPointerMove({ ...mouse, clientX: 20 });
  brush.handleBrushPointerEnd({ ...mouse, type: "pointerup", buttons: 0 });
  assert.equal(session, null);
});
