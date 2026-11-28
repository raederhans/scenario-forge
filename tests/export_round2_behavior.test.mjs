import assert from "node:assert/strict";
import test from "node:test";
import { createExportWorkflowController } from "../js/ui/toolbar/export_workflow_controller.js";
import { callRuntimeHook } from "../js/core/state/index.js";
import { drawPoliticalExportLegend } from "../js/core/renderer/political_export_legend.js";

test("quick export uses saved visibility and adds the ocean beneath JPG before blob download", async t => {
  const passes = [], fills = [], downloads = [];
  const ctx = { drawImage() {}, save() {}, restore() {}, fillRect() { fills.push([this.fillStyle, this.globalCompositeOperation]); } };
  const canvas = () => ({ width: 100, height: 50, getContext: () => ctx,
    toBlob(cb, type) { cb(new Blob(["image"], { type })); } });
  const document = {
    querySelectorAll: () => [], getElementById: () => null,
    createElement: tag => tag === "canvas" ? canvas() : { click() { downloads.push(this.href); }, remove() {} },
    body: { appendChild() {} },
  };
  t.mock.method(URL, "createObjectURL", blob => blob.type);
  t.mock.method(URL, "revokeObjectURL", () => {});
  globalThis.document = document;
  t.after(() => { delete globalThis.document; });
  const state = { width: 100, height: 50, colorCanvas: canvas(), exportWorkbenchUi: {
    format: "jpg", scale: "1.5", visibility: { background: false }, includeTextLayer: false, textVisibility: { legend: false },
  } };
  const noop = () => {};
  const workflow = createExportWorkflowController({
    state, document, t: key => key, renderPassNames: ["background", "political"],
    ensureScenarioPoliticalDetailForExport: noop, ensurePaintContoursReady: noop,
    ensureCountryLabelsReadyForExport: noop, ensureBathymetryReadyForExport: noop,
    getOceanBaseFillColor: () => "#addfff",
    renderExportPassesToCanvas(names, options) { passes.push([names, options.pixelRatio]); return canvas(); },
  });
  await callRuntimeHook(state, "runQuickReexportFn");
  assert.deepEqual(passes, [[["political"], 1.5]]);
  assert.deepEqual(fills, [["#addfff", "destination-over"]]);
  assert.deepEqual(downloads, ["image/jpeg"]);
});

function draw(state) {
  const rects = [], texts = [], arcs = [], outlines = [];
  const ctx = {
    save() {}, restore() {}, setTransform() {}, translate() {}, rotate() {}, beginPath() {}, rect() {}, clip() {}, fill() {},
    arc() { arcs.push(this.globalAlpha); },
    fillRect(x, y, w, h) { rects.push([this.fillStyle, this.globalAlpha, x, y, w, h]); },
    strokeRect() { outlines.push(this.strokeStyle); },
    fillText(label, x) { texts.push([label, x, this.globalAlpha]); },
    measureText(s) { return { width: Array.from(s).length * 8 }; },
  };
  drawPoliticalExportLegend({ width: 800, height: 400, getContext: () => ctx }, state, 1);
  return { rects, texts, arcs, outlines };
}

test("zone fills, pattern opacity and outline-only swatches follow the layer style", () => {
  const state = { specialZoneLayers: { layers: [
    { id: "dots", style: { fill: "#333333", fillOpacity: 0.2, pattern: "dots", patternOpacity: 0.7 } },
    { id: "edge", style: { fill: "#999999", pattern: "outlineOnly" } },
  ] } };
  const { rects, arcs, outlines } = draw(state);
  assert.deepEqual(rects.slice(1).map(r => r.slice(0, 2)), [["#333333", 0.2]]);
  assert.ok(arcs.length > 0 && arcs.every(alpha => alpha === 0.7));
  assert.equal(outlines.length, 2);
});
