import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { clearHistory } from "../js/core/history_manager.js";
import { placeMapLabel } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";
import { drawManualMapLabels } from "../js/core/renderer/manual_map_label_render_owner.js";

test("placed labels avoid imported ids", () => {
  clearHistory();
  state.mapLabelEditor.counter = 1;
  state.mapLabels = [normalizeMapLabel({ lon: 1, lat: 1, text: "Old" }, "map_label_8")];
  state.zoomTransform = { x: 0, y: 0, k: 3 };
  const id = placeMapLabel({ lon: 2, lat: 4, countryCode: "ger" });
  assert.equal(id, "map_label_9");
});

function makeCanvas() {
  const stack = [], paints = [];
  let x = 0, y = 0, angle = 0;
  return {
    paints, globalAlpha: 1, globalCompositeOperation: "source-over", canvas: { width: 600, height: 400 },
    measureText: () => ({ width: 10 }),
    save() { stack.push([x, y, angle]); },
    restore() { [x, y, angle] = stack.pop(); },
    translate(dx, dy) {
      x += dx * Math.cos(angle) - dy * Math.sin(angle);
      y += dx * Math.sin(angle) + dy * Math.cos(angle);
    },
    rotate(turn) { angle += turn; },
    getTransform() {
      return { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: x, f: y };
    },
    setTransform(a, b, c, d, e, f) { x = e; y = f; angle = Math.atan2(b, a); },
    strokeText(text) { paints.push({ method: "stroke", text, x, y, angle }); },
    fillText(text) { paints.push({ method: "fill", text, x, y, angle }); },
  };
}

function paint(ctx, raw, occupiedBoxes = []) {
  const label = normalizeMapLabel({ lon: 10, lat: 20, size: 20, tracking: 0.1, curve: 60, ...raw }, "a");
  return drawManualMapLabels({ state: { mapLabels: [label] }, ctx, projection: point => point,
    k: 1, occupiedBoxes }).get("a");
}

test("negative multiline curves keep line spacing and local glyphs through label rotation", () => {
  const ctx = makeCanvas();
  const { glyphs } = paint(ctx, { text: "ABC\nABC", curve: -60, rotation: 90 });
  assert.equal(glyphs[4].y - glyphs[1].y, 24);
  assert.ok(glyphs[0].y < glyphs[1].y && glyphs[0].angle > 0);
  assert.ok(Math.abs(ctx.paints[0].x - (10 - glyphs[0].y)) < 1e-9);
  assert.ok(Math.abs(ctx.paints[0].angle - glyphs[0].angle - Math.PI / 2) < 1e-9);
});

test("shaping scripts retain whole-line paints and bounds", () => {
  const ctx = makeCanvas(), boxes = [];
  const text = "مرحبا";
  assert.equal(paint(ctx, { text }, boxes).glyphs, null);
  assert.deepEqual(ctx.paints.map(p => [p.method, p.text]), [["stroke", text], ["fill", text]]);
  assert.equal(boxes.length, 1);
});
