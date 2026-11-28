import test from "node:test";
import assert from "node:assert/strict";
import { FileManager } from "../js/core/file_manager.js";
import { normalizeMapTitles, drawMapTitles, renderViewportMapTitles, positionMapTitleAwareLegend } from "../js/core/renderer/map_title_render_owner.js";

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

test("viewport layout stays fixed through zoom, stacks centered text, and scales for export", () => {
  const screen = canvas(400, 240);
  const view = { width: 400, height: 240, dpr: 1, exportWorkbenchUi: { mapTitles: titles } };
  renderViewportMapTitles(screen, view);
  const calls = screen.calls.splice(0);
  view.zoomTransform = { k: 6, x: -400, y: 100 };
  renderViewportMapTitles(screen, view);
  assert.deepEqual(screen.calls, calls);
  assert.equal(calls[2][2], 200);
  assert.ok(calls[3][2] >= calls[1][2] + calls[1][4]);
  assert.equal(calls[5][1] + calls[5][3], 388);
  const output = canvas(800, 480);
  drawMapTitles(output, titles, 2);
  assert.deepEqual(output.calls, [[2, 0, 0, 2, 0, 0], ...calls.slice(1)]);
});

test("automatic legend placement clears the occupied lower-left corner", () => {
  const target = canvas(800, 480);
  const mapTitles = { attribution: { ...titles.attribution, position: "bottom-left" } };
  assert.deepEqual(positionMapTitleAwareLegend(target, { width: 400, exportWorkbenchUi: { mapTitles } }, 2, 100, 70), [288, 158]);
});
