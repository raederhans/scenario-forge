import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { clearHistory } from "../js/core/history_manager.js";
import { placeMapLabel } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { renderMapLabelHandles } from "../js/core/renderer/map_label_handles_owner.js";

class SvgNode extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  constructor(doc) { super(); this.ownerDocument = doc; }
  setAttribute() {}
  appendChild(child) { child.parentNode = this; this.children.push(child); }
  remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

test("cancelling a label drag keeps its coordinates and history", () => {
  clearHistory();
  const doc = new EventTarget();
  doc.createElementNS = () => new SvgNode(doc);
  const group = new SvgNode(doc);
  state.mapLabels = [];
  state.mapLabelEditor.active = false;
  state.zoomTransform = { k: 3, x: 10, y: 20 };
  const id = placeMapLabel({ lon: 2, lat: 4, text: "北\n南", size: 5, rotation: -24 });
  state.mapLabelEditor.selectedId = null;
  const original = state.mapLabels;
  const before = state.historyPast.length;
  const projection = ([lon, lat]) => [lon * 2, lat * 2];
  projection.invert = ([x, y]) => [x / 2, y / 2];
  renderMapLabelHandles({ group, state, k: 3, projection,
    placed: [{ id, bounds: { x: 22, y: 44, w: 30, h: 30 } }],
    pointer: e => [(e.clientX - 10) / 3, (e.clientY - 20) / 3],
  });
  const event = (type, x, y) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y });
  const rect = group.children[0];
  rect.onpointerdown(event("pointerdown", 22, 44));
  assert.equal(state.mapLabelEditor.draggingId, id);
  rect.dispatchEvent(event("pointermove", 70, 80));
  doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  rect.dispatchEvent(event("pointerup", 70, 80));
  assert.equal(state.mapLabelEditor.draggingId, null);
  assert.equal(state.mapLabels, original);
  assert.deepEqual([original[0].lon, original[0].lat], [2, 4]);
  assert.equal(state.historyPast.length, before);
});
