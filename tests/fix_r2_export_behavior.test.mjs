import assert from "node:assert/strict";
import test from "node:test";
import { createExportBakeRuntime } from "../js/ui/toolbar/export_bake_runtime.js";

test("composite titles keep their logical margins and height when exporting below screen DPR", async () => {
  const rectangles = [];
  const ctx = {
    save() {}, restore() {}, fillText() {},
    measureText: () => ({ width: 64 }),
    setTransform(a, _b, _c, d) { this.scaleX = a; this.scaleY = d; },
    fillRect(x, y, w, h) {
      rectangles.push([x * this.scaleX, y * this.scaleY, w * this.scaleX, h * this.scaleY]);
    },
  };
  const source = { width: 800, height: 480, getContext: () => ctx };
  const ready = () => {};
  const runtime = createExportBakeRuntime({
    state: { width: 400, height: 240, dpr: 2 },
    renderPassNames: ["background"],
    renderExportPassesToCanvas: () => source,
    ensureScenarioPoliticalDetailForExport: ready,
    ensurePaintContoursReady: ready,
    ensureCountryLabelsReadyForExport: ready,
    ensureBathymetryReadyForExport: ready,
  });
  const ui = { mapTitles: { title: { enabled: true, text: "Atlas", position: "bottom-right" } } };
  for (const scale of [1, 1.5]) {
    await runtime.buildCompositeSourceCanvas(ui, { width: 400 * scale, height: 240 * scale, pixelRatio: scale });
    assert.deepEqual(rectangles.pop(), [616, 368, 160, 88]);
  }
});
