import assert from "node:assert/strict";
import test from "node:test";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";

function makeCanvas(width = 800, height = 600) {
  const calls = [];
  const ctx = {
    save() {}, restore() {}, drawImage() {}, strokeRect() {},
    setTransform(...args) { calls.push(["transform", ...args]); },
    fillRect(...args) { calls.push(["rect", this.fillStyle, this.globalAlpha, ...args]); },
    measureText(text) { return { width: text.length * 7 }; },
    fillText(text) { calls.push(["text", text]); },
  };
  return { width, height, calls, getContext: () => ctx };
}

function setup() {
  const state = {
    width: 800, height: 600, colorCanvas: makeCanvas(), currentLanguage: "zh",
    colors: { a: "#123456", b: "#abcdef" },
    legendLabels: { "#123456": " 北方 ", "#aaaaaa": "未使用" },
    legendControl: { visible: false, xRatio: 0.5, yRatio: 0.25, opacity: 0.65, width: 200 },
    specialZoneLayers: { layers: [
      { id: "zone", name: "Zone", nameZh: "自治区", style: { fill: "#998877" } },
      { id: "hidden", visible: false },
      { id: "omitted", legendVisible: false },
    ] },
  };
  const ui = { textVisibility: { legend: true, "render-labels": false } };
  const ready = async () => {};
  const runtime = createExportBakeRuntime({
    state, document: { createElement: () => makeCanvas(), getElementById: () => null },
    ensureExportWorkbenchUiState: () => ui, renderPassNames: [],
    ensureScenarioPoliticalDetailForExport: ready, ensurePaintContoursReady: ready,
    ensureCountryLabelsReadyForExport: ready, ensureBathymetryReadyForExport: ready,
    renderExportPassesToCanvas: (_, { pixelRatio = 1 } = {}) => makeCanvas(800 * pixelRatio, 600 * pixelRatio),
  });
  return { state, ui, runtime };
}

test("composite paints the named colors and visible zones at the overlay ratios", async () => {
  const { runtime, ui } = setup();
  const { calls } = await runtime.buildCompositeSourceCanvas(ui, { pixelRatio: 2 });
  assert.deepEqual(calls[0], ["transform", 2, 0, 0, 2, 0, 0]);
  const [, , opacity, x, y, width, height] = calls[1];
  assert.equal(opacity, 0.65);
  assert.equal(x, Math.round((800 - width - 8) * 0.5));
  assert.equal(y, Math.round((600 - height - 8) * 0.25));
  assert.deepEqual(calls.filter(([kind]) => kind === "text").map(call => call[1]), ["图例", "北方", "特殊区域图层", "自治区"]);
  assert.deepEqual(calls.filter(([kind]) => kind === "rect").slice(1).map(call => call[1]), ["#123456", "#998877"]);
});

test("disabled and empty legends leave the composite untouched", async () => {
  const { runtime, state, ui } = setup();
  ui.textVisibility.legend = false;
  assert.deepEqual((await runtime.buildCompositeSourceCanvas(ui)).calls, []);
  ui.textVisibility.legend = true;
  state.legendLabels = {};
  state.showSpecialZones = false;
  assert.deepEqual((await runtime.buildCompositeSourceCanvas(ui)).calls, []);
});

test("the text bake and separate legend layer contain the legend and reflect label edits", async () => {
  const { runtime, state, ui } = setup();
  const text = await runtime.bakeLayer("text", ui);
  assert.ok(text.calls.some(([, label]) => label === "北方"));
  const separate = await runtime.buildSingleExportSourceCanvas(ui, "legend");
  assert.deepEqual(separate.calls, text.calls);
  const color = await runtime.bakeLayer("color", ui);
  assert.deepEqual(color.calls, []);
  state.legendLabels["#123456"] = "南方";
  assert.ok((await runtime.bakeLayer("text", ui)).calls.some(([, label]) => label === "南方"));
});
