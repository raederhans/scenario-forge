import assert from "node:assert/strict";
import test from "node:test";
import { state } from "../js/core/state.js";
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

test("off-center label drag preserves the grab offset", () => {
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
  rect.dispatchEvent(event("pointermove", 160, 110));
  const preview = group.children[1].attrs.transform;
  rect.dispatchEvent(event("pointerup", 160, 110));
  const { lon, lat } = state.mapLabels[0];
  assert.deepEqual([lon, lat], [22.5, 28.5]);
  assert.equal(preview, "translate(45 57) rotate(0)");
  assert.equal(state.mapLabelEditor.selectedId, id);
  assert.deepEqual(state.historyPast.slice(before).map(entry => entry.kind), ["move-map-label"]);
});
