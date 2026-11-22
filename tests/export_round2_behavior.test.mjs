import assert from "node:assert/strict";
import test from "node:test";
import { createExportWorkflowController } from "../js/ui/toolbar/export_workflow_controller.js";
import { createExportWorkbenchController } from "../js/ui/toolbar/export_workbench_controller.js";
import { normalizeExportWorkbenchUiState } from "../js/core/state_defaults.js";
import { callRuntimeHook } from "../js/core/state/index.js";
import { drawPoliticalExportLegend } from "../js/core/renderer/political_export_legend.js";
import { state as runtimeState } from "../js/core/state.js";
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory } from "../js/core/history_manager.js";
import { FileManager } from "../js/core/file_manager.js";

class Control {
  dataset = {};
  attributes = {};
  listeners = {};
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
}

function workbench(overrides = {}) {
  const exportBtn = new Control();
  const exportCopyBtn = new Control();
  const exportJobStatus = new Control();
  const state = { width: 1600, height: 900, dpr: 2 };
  const exportScale = { options: ["1", "2", "4"].map(value => ({ value })) };
  const exportSectionSummaryScale = {};
  const notices = [];
  const noop = () => {};
  const controller = createExportWorkbenchController({
    state, exportBtn, exportCopyBtn, exportJobStatus, exportScale, exportSectionSummaryScale,
    t: key => key, normalizeExportWorkbenchUiState, renderPassNames: ["background"],
    buildCompositeSourceCanvas: noop, buildSingleExportSourceCanvas: noop, applyExportAdjustmentsToCanvas: noop,
    bakeLayer: noop, clearBakeCache: noop, showToast: (...args) => notices.push(args),
    showExportFailureToast: assert.fail, ...overrides,
  });
  return { controller, state, exportBtn, exportCopyBtn, exportJobStatus, exportScale, exportSectionSummaryScale, notices };
}

test("resolution options reflect logical output, memory budget and resized viewport", () => {
  const h = workbench({ isExportRenderOverBudget: (_, scale) => scale === 4 });
  h.controller.syncExportWorkbenchControlsFromState();
  assert.match(h.exportScale.options[0].textContent, /1600×900.*Below screen resolution/);
  assert.equal(h.exportSectionSummaryScale.textContent, "2× · 3200×1800");
  assert.equal(h.exportScale.options[2].disabled, true);
  assert.match(h.exportScale.options[2].textContent, /Exceeds render budget/);
  h.state.width = 2100;
  h.controller.syncExportWorkbenchControlsFromState();
  assert.match(h.exportScale.options[2].textContent, /8400×3600.*Exceeds 8K/);
});

test("download stays busy through encoding and success opens settings only on request", async () => {
  let release, encoded, opens = 0;
  const encoding = new Promise(resolve => { encoded = resolve; });
  const h = workbench({
    buildCompositeExportCanvas: async (ui, scale, rendering) => {
      assert.equal(scale, 2);
      assert.equal(h.exportJobStatus.textContent, "Preparing export data…");
      await rendering();
      assert.equal(h.exportJobStatus.textContent, "Rendering map…");
      return {};
    },
    triggerCanvasDownload: () => new Promise(resolve => { release = resolve; encoded(); }),
    openSettings: () => opens++,
  });
  const done = h.controller.handleExportAction();
  await encoding;
  assert.equal(h.exportJobStatus.textContent, "Encoding image…");
  assert.equal(h.exportBtn.disabled, true);
  assert.equal(h.exportBtn.attributes["aria-busy"], "true");
  assert.equal(h.exportBtn.textContent, "Exporting…");
  await h.controller.handleExportAction();
  release();
  await done;
  assert.equal(h.exportBtn.disabled, false);
  assert.equal(h.exportJobStatus.hidden, true);
  assert.equal(h.notices.length, 1);
  assert.equal(opens, 0);
  h.notices[0][1].onAction();
  assert.equal(opens, 1);
});

test("clipboard accepts a PNG even with JPG selected, and unsupported browsers explain the disabled button", async t => {
  const h = workbench({ buildCompositeExportCanvas: async () => ({
    toBlob(callback, type) { callback(new Blob(["pixels"], { type })); },
  }) });
  const globals = ["ClipboardItem", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, desc] of globals) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete globalThis[key];
  } });
  globalThis.ClipboardItem = undefined;
  h.state.exportWorkbenchUi = { format: "jpg" };
  h.controller.syncExportWorkbenchControlsFromState();
  assert.equal(h.exportCopyBtn.disabled, true);
  assert.match(h.exportCopyBtn.title, /unavailable/);
  globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
  let received;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
    async write([item]) { received = await item.data["image/png"]; },
  } } });
  await h.controller.handleExportAction({ copy: true });
  assert.equal(received.type, "image/png");
  assert.match(h.notices[0][0], /Image copied/);
});

test("quick export uses saved visibility and adds the ocean beneath JPG before blob download", async t => {
  const passes = [], fills = [], downloads = [];
  const hint = {}, transparent = {};
  const ctx = { drawImage() {}, save() {}, restore() {}, fillRect() { fills.push([this.fillStyle, this.globalCompositeOperation]); } };
  const canvas = () => ({ width: 100, height: 50, getContext: () => ctx,
    toBlob(cb, type) { cb(new Blob(["image"], { type })); } });
  const document = {
    querySelectorAll: () => [], getElementById: id => ({ exportJpegHint: hint, exportTransparentBackground: transparent })[id],
    createElement: tag => tag === "canvas" ? canvas() : { click() { downloads.push(this.href); }, remove() {} },
    body: { appendChild() {} },
  };
  t.mock.method(URL, "createObjectURL", blob => blob.type);
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
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
  workflow.syncExportWorkbenchControlsFromState();
  assert.equal(transparent.disabled, true);
  assert.equal(hint.hidden, false);
  await callRuntimeHook(state, "runQuickReexportFn");
  assert.deepEqual(passes, [[["political"], 1.5]]);
  assert.deepEqual(fills, [["#addfff", "destination-over"]]);
  assert.deepEqual(downloads, ["image/jpeg"]);
  assert.equal(revoke.mock.callCount(), 0);
  state.exportWorkbenchUi.format = "png";
  workflow.syncExportWorkbenchControlsFromState();
  assert.equal(transparent.checked, true);
  assert.equal(transparent.disabled, false);
  await callRuntimeHook(state, "runQuickReexportFn");
  assert.deepEqual(downloads, ["image/jpeg", "image/png"]);
  assert.equal(fills.length, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(revoke.mock.callCount(), 2);
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

test("legend layout uses columns, ellipses, opaque text and saved background settings", () => {
  const colors = {}, legendLabels = {};
  for (let i = 0; i < 14; i++) {
    colors[i] = "#" + i.toString(16).padStart(6, "0");
    legendLabels[colors[i]] = "Country ".repeat(8) + i;
  }
  const legendConfig = { title: "1962", exportBackground: "dark", exportOpaque: true };
  const saved = FileManager.buildProjectPayload({ colors, legendConfig });
  const imported = FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(saved)));
  assert.equal(imported.legendConfig.title, "1962");
  const state = { colors, legendLabels, legendConfig: imported.legendConfig };
  const { rects, texts } = draw(state);
  assert.deepEqual(rects[0].slice(0, 2), ["#1f2937", 1]);
  assert.equal(texts[0][0], "1962");
  assert.ok(new Set(texts.slice(1).map(row => row[1])).size >= 2);
  assert.ok(texts.slice(1).every(([label, , alpha]) => label.endsWith("…") && alpha === 1));
  state.legendConfig.exportBackground = "none";
  assert.equal(draw(state).rects.length, 14);
});

test("political modes export their categories and alliance explanation", () => {
  const state = { politicalDisplayMode: "alliance", currentLanguage: "zh", activeScenarioId: "map",
    landDataFull: { features: [{ id: "land" }] }, scenarioBaselineOwnersByFeatureId: { land: "A" },
    scenarioBundleCacheById: { map: { countriesPayload: { countries: { A: { ruling_ideology: "democratic", alliance: "allies" } } } } } };
  const labels = draw(state).texts.map(([label]) => label);
  assert.ok(labels.includes("allies（1 国）"));
  assert.ok(labels.includes("未结盟国家按政体浅色显示"));
  state.politicalDisplayMode = "government";
  assert.ok(draw(state).texts.some(([s]) => s === "民主"));
});

test("legend appearance history restores the selected export settings", t => {
  const original = { ...runtimeState.legendConfig };
  const past = runtimeState.historyPast, future = runtimeState.historyFuture;
  t.after(() => Object.assign(runtimeState, { legendConfig: original, historyPast: past, historyFuture: future }));
  runtimeState.historyPast = [];
  runtimeState.historyFuture = [];
  const before = captureHistoryState({ legendConfig: true });
  runtimeState.legendConfig = { ...original, title: "1962", exportOpaque: true };
  pushHistoryEntry({ kind: "legend-appearance", before, after: captureHistoryState({ legendConfig: true }) });
  undoHistory();
  assert.deepEqual(runtimeState.legendConfig, original);
  redoHistory();
  assert.equal(runtimeState.legendConfig.title, "1962");
  assert.equal(runtimeState.legendConfig.exportOpaque, true);
});
