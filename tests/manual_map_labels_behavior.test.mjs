import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../js/core/state.js";
import { clearHistory, undoHistory, redoHistory } from "../js/core/history_manager.js";
import { placeMapLabel, updateMapLabel, commitMapLabelMove, deleteMapLabel, applyMapLabelStyleToPreset } from "../js/core/renderer/strategic_overlay_runtime/map_label_runtime_domain.js";
import { createDefaultStrategicOverlayState, normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";
import { drawManualMapLabels } from "../js/core/renderer/manual_map_label_render_owner.js";

import { createLabelDrawSnapshotOwner } from "../js/core/renderer/label_draw_snapshot.js";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { renderMapLabelHandles } from "../js/core/renderer/map_label_handles_owner.js";

test("placed labels keep independent reversible history and avoid imported ids", () => {
  clearHistory();
  state.mapLabelEditor.counter = 1;
  state.mapLabels = [normalizeMapLabel({ lon: 1, lat: 1, text: "Old" }, "map_label_8")];
  state.zoomTransform = { x: 0, y: 0, k: 3 };
  const snapshots = [state.mapLabels];
  const id = placeMapLabel({ lon: 2, lat: 4, countryCode: "ger" });
  assert.equal(id, "map_label_9");
  assert.equal(state.mapLabels[1].size, state.mapLabels[0].size);
  snapshots.push(state.mapLabels);
  assert.equal(updateMapLabel(id, { text: "New" }), true);
  snapshots.push(state.mapLabels);
  assert.equal(commitMapLabelMove(id, 12, -40), true);
  snapshots.push(state.mapLabels);
  assert.equal(deleteMapLabel(id), true);
  snapshots.push(state.mapLabels);
  assert.equal(new Set(snapshots).size, 5);
  assert.deepEqual(state.historyPast.map(entry => entry.kind),
    ["place-map-label", "edit-map-label", "move-map-label", "delete-map-label"]);
  for (const expected of snapshots.slice(0, -1).reverse()) {
    assert.equal(undoHistory(), true);
    assert.deepEqual(state.mapLabels, expected);
  }
  for (const expected of snapshots.slice(1)) {
    assert.equal(redoHistory(), true);
    assert.deepEqual(state.mapLabels, expected);
  }
});

test("manual lettering rotates multiline text and reserves each painted line", () => {
  const paints = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate(angle) { assert.equal(angle, Math.PI / 2); },
    globalAlpha: 1, measureText: text => ({ width: text.length * 10 }),
    fillText(text) { paints.push(["fill", text, this.font]); },
    strokeText(text) { paints.push(["stroke", text, this.font]); },
  };
  const label = normalizeMapLabel({ text: "测试\nMap", lon: 4, lat: 5, size: 12, rotation: 90, curve: 0 }, "map_label_1");
  const occupiedBoxes = [];
  const draw = k => drawManualMapLabels({ state: { mapLabels: [label] }, ctx,
    requestChineseTextGlyphs: titles => assert.deepEqual(titles, ["测试\nMap"]),
    projection: point => point, k, occupiedBoxes });
  assert.equal(draw(0.5).size, 0);
  assert.deepEqual(paints, []);
  assert.equal(draw(8).size, 1);
  assert.deepEqual(paints.map(([type, text]) => [type, text]), [
    ["stroke", "测试"], ["fill", "测试"], ["stroke", "Map"], ["fill", "Map"],
  ]);
  assert.match(paints[0][2], /400 12px "Map Noto Serif SC"/);
  assert.equal(ctx.letterSpacing, "1.44px");
  assert.equal(occupiedBoxes.length, 2);
  assert.ok(occupiedBoxes[0].x > occupiedBoxes[1].x);
  assert.ok(occupiedBoxes[1].h > occupiedBoxes[1].w);
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

test("curved graphemes reserve tracked boxes and replay their individual paints", () => {
  const ctx = makeCanvas(), boxes = [];
  const snapshot = createLabelDrawSnapshotOwner();
  const transform = { x: 0, y: 0, k: 1 };
  const record = snapshot.capture("labels", ctx, { transform, dpr: 1, signature: "arc" },
    target => paint(target, { text: "A e\u0301 B" }, boxes));
  const expected = ["A", "e\u0301", "B"];
  assert.deepEqual(ctx.paints.map(p => p.text), [...expected, ...expected]);
  assert.deepEqual(ctx.paints.map(p => p.method), ["stroke", "stroke", "stroke", "fill", "fill", "fill"]);
  const [first, middle, last] = ctx.paints;
  assert.ok(Math.abs((last.angle - first.angle) * 180 / Math.PI - 60 * 48 / 58) < 1e-6);
  assert.ok(Math.hypot(middle.x - 10, middle.y - 20) <= 0.6 * 20);
  assert.ok(first.y > middle.y && last.y > middle.y);
  assert.equal(boxes.length, 3);
  assert.equal(boxes[1].w, 10 + 2 + 20 * 0.14);
  assert.equal(record.glyphs.length, 3);
  const original = ctx.paints.splice(0);
  assert.ok(snapshot.replay(["labels"], ctx, transform, 1, () => "arc"));
  assert.deepEqual(ctx.paints, original);
  snapshot.clear();
});

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

test("curvature is sparse, clamped and copied independently of style", () => {
  const normalize = curve => normalizeMapLabel({ lon: 0, lat: 1, curve }, "label");
  assert.equal(normalize(999).curve, 180);
  assert.equal(normalize(-999).curve, -180);
  assert.equal(Object.hasOwn(normalize(0), "curve"), false);
  state.mapLabels = [];
  const first = placeMapLabel(normalize(60));
  const next = placeMapLabel({ lon: 2, lat: 2 });
  assert.equal(state.mapLabels[1].curve, undefined);
  updateMapLabel(next, { curve: -90, size: 22 });
  applyMapLabelStyleToPreset(first);
  assert.equal(state.mapLabels[1].curve, -90);
  placeMapLabel({ ...state.mapLabels[0], lon: 3 });
  assert.equal(state.mapLabels[2].curve, 60);
  const editors = createDefaultStrategicOverlayState();
  for (const editor of [editors.operationalLineEditor, editors.operationGraphicsEditor]) {
    assert.equal(editor.labelSize, 9);
    assert.equal(editor.labelOnPath, false);
  }
});

test("drag preview retains the screen glyphs and scaled size after an export", () => {
  const ctx = makeCanvas(), projection = point => point;
  let exporting = false;
  const local = {
    mapLabels: [normalizeMapLabel({ lon: 1, lat: 2, countryCode: "ITA", fallbackName: "Italy",
      colorMode: "dark", size: 16, curve: 60 }, "a")],
    zoomTransform: { x: 0, y: 0, k: 1 }, mapLabelEditor: {}, showCityPoints: false,
    styleConfig: { countryLabels: { enabled: false, sizeScale: 1.5 } },
  };
  const runtime = createLabelsRuntime({ runtimeState: local, isExportRenderInProgress: () => exporting,
    rendererSurfaceHost: { getContext: () => ctx, getProjection: () => projection, getMapSvg: () => null, getPathCanvas: () => null },
    isPrivateSceneActive: () => true, getFeatureCollectionFeatureCount: () => 0, nowMs: () => 0, collectContextMetric() {}, recordRenderPerfMetric() {}, recordInteractionDurationMetric() {},
    drawPendingTransportLabels() {}, drawPhysicalRegionLabels() {} });
  runtime.drawLabelsPassContent(1);
  const screen = runtime.getPlacedMapLabels();
  assert.equal(screen[0].fontSize, 24);
  assert.equal(screen[0].glyphs.length, 5);
  runtime.getPlacedMapLabels()[0].glyphs[0].x = -999;
  exporting = true;
  local.styleConfig.countryLabels.sizeScale = 2;
  runtime.drawLabelsPassContent(2);
  const placed = runtime.getPlacedMapLabels();
  assert.deepEqual(placed, screen);

  class SvgNode extends EventTarget {
    children = [];
    dataset = {};
    style = {};
    attrs = {};
    appendChild(child) { this.children.push(child); }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    setPointerCapture() {}
  }
  const group = new SvgNode();
  group.ownerDocument = Object.assign(new EventTarget(), { createElementNS: () => new SvgNode() });
  renderMapLabelHandles({ group, state: local, projection, placed, k: 1, pointer: () => [1, 2] });
  group.children[0].onpointerdown(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 1 }));
  const preview = group.children[1];
  assert.equal(preview.attrs["font-size"], "24");
  assert.equal(preview.attrs["letter-spacing"], "0");
  assert.deepEqual(preview.children.map(node => node.textContent), Array.from("ITALY"));
  for (const [i, glyph] of placed[0].glyphs.entries()) {
    assert.equal(preview.children[i].attrs.transform, `translate(${glyph.x} ${glyph.y}) rotate(${glyph.angle * 180 / Math.PI})`);
  }
});
