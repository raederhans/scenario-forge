import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { state } from "../js/core/state.js";
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory } from "../js/core/history_manager.js";
import { normalizeMapTitles, drawMapTitles, renderViewportMapTitles, positionMapTitleAwareLegend } from "../js/core/renderer/map_title_render_owner.js";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";

const titles = normalizeMapTitles({
  title: { enabled: true, text: "1962 年的欧洲", background: "dark" },
  subtitle: { enabled: true, text: "Europe" },
  attribution: { enabled: true, text: "Atlas" },
});

function canvas(width, height) {
  const calls = [];
  const ctx = {
    save() {}, restore() {}, clearRect() {}, drawImage() {},
    measureText: text => ({ width: text.length * 12 }),
    setTransform(...args) { calls.push(args); },
    fillText(...args) { calls.push([this.font, ...args]); },
    fillRect(...args) { calls.push([this.fillStyle, ...args]); },
  };
  return { width, height, calls, style: {}, getContext: () => ctx };
}

test("old projects start with all three fields off, and project JSON preserves their settings", () => {
  const payload = FileManager.buildProjectPayload({ exportWorkbenchUi: { mapTitles: titles } });
  const read = () => FileManager.normalizeImportedProjectData(JSON.parse(JSON.stringify(payload))).exportWorkbenchUi.mapTitles;
  assert.deepEqual(read(), titles);
  delete payload.exportWorkbenchUi.mapTitles;
  assert.deepEqual(Object.values(read()).map(row => [row.enabled, row.text]), Array(3).fill([false, ""]));
});

test("undo and redo restore only the title fields", () => {
  state.exportWorkbenchUi.mapTitles = normalizeMapTitles(null);
  const capture = () => captureHistoryState({ mapTitles: true });
  const before = capture();
  state.exportWorkbenchUi.mapTitles = structuredClone(titles);
  assert.ok(pushHistoryEntry({ before, after: capture() }));
  state.exportWorkbenchUi.format = "jpg";
  undoHistory();
  assert.deepEqual(state.exportWorkbenchUi.mapTitles, normalizeMapTitles(null));
  redoHistory();
  assert.deepEqual(state.exportWorkbenchUi.mapTitles, titles);
  assert.equal(state.exportWorkbenchUi.format, "jpg");
});

test("viewport layout stays fixed through zoom, stacks centered text, and scales for export", () => {
  const screen = canvas(400, 240);
  const view = { width: 400, height: 240, dpr: 1, exportWorkbenchUi: { mapTitles: titles } };
  renderViewportMapTitles(screen, view);
  const calls = screen.calls.splice(0);
  view.zoomTransform = { k: 6, x: -400, y: 100 };
  renderViewportMapTitles(screen, view);
  assert.deepEqual(screen.calls, calls);
  assert.match(calls[2][0], /32px "Map Noto Serif SC"/);
  assert.match(calls[4][0], /20px "Map Garamond"/);
  assert.equal(calls[1][0], "#25303a");
  assert.equal(calls[2][2], 200);
  assert.ok(calls[3][2] >= calls[1][2] + calls[1][4]);
  assert.equal(calls[5][1] + calls[5][3], 388);
  const output = canvas(800, 480);
  drawMapTitles(output, titles, 2);
  assert.deepEqual(output.calls, [[2, 0, 0, 2, 0, 0], ...calls.slice(1)]);
  view.exportWorkbenchUi.mapTitles = {};
  renderViewportMapTitles(screen, view);
  assert.equal(screen.style.display, "none");
});

test("automatic legend placement clears the occupied lower-left corner", () => {
  const target = canvas(800, 480);
  const mapTitles = { attribution: { ...titles.attribution, position: "bottom-left" } };
  assert.deepEqual(positionMapTitleAwareLegend(target, { width: 400, exportWorkbenchUi: { mapTitles } }, 2, 100, 70), [288, 158]);
});

test("composite, transparent output, and text bake paint enabled titles, and edits invalidate the bake", async () => {
  const view = { width: 400, height: 240, colorCanvas: canvas(400, 240) };
  const ui = { mapTitles: structuredClone(titles), textVisibility: { "render-labels": false } };
  const ready = async () => {};
  const runtime = createExportBakeRuntime({
    state: view, document: { createElement: () => canvas(0, 0), getElementById: () => null },
    ensureExportWorkbenchUiState: () => ui, renderPassNames: [],
    ensureScenarioPoliticalDetailForExport: ready, ensurePaintContoursReady: ready,
    ensureCountryLabelsReadyForExport: ready, ensureBathymetryReadyForExport: ready,
    renderExportPassesToCanvas: () => canvas(800, 480),
  });
  const dimensions = { width: 800, height: 480, pixelRatio: 2 };
  const composite = await runtime.buildCompositeSourceCanvas(ui, dimensions);
  const layer = await runtime.buildSingleExportSourceCanvas(ui, "map-titles", dimensions);
  assert.deepEqual(composite.calls, layer.calls);
  assert.equal(layer.calls.at(-1)[1], "Atlas");
  const first = await runtime.bakeLayer("text", ui);
  ui.mapTitles.attribution.text = "Revised";
  const second = await runtime.bakeLayer("text", ui);
  assert.notEqual(first, second);
  assert.equal(second.calls.at(-1)[1], "Revised");
});
