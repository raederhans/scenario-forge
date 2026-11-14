import test from "node:test";
import assert from "node:assert/strict";
import { EXPORT_RENDER_BUDGET_BYTES, estimateExportRenderBytes } from "../js/core/renderer/export_render_budget.js";
import { RENDER_PASS_OVERSCAN_RATIO_PER_SIDE, TRANSFORMED_FRAME_PASS_NAMES } from "../js/core/map_renderer/render_pass_catalog.js";

test("river internal contours charge one border-sized RGBA scratch without changing the budget", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["borders", "borders"] };
  const overscan = TRANSFORMED_FRAME_PASS_NAMES.includes("borders") ? RENDER_PASS_OVERSCAN_RATIO_PER_SIDE : 0;
  const borderWidth = Math.floor((100 + 2 * Math.ceil(100 * overscan)) * 2);
  const borderHeight = Math.floor((80 + 2 * Math.ceil(80 * overscan)) * 2);
  assert.equal(estimateExportRenderBytes({ ...input, riverInternalContours: true })
    - estimateExportRenderBytes(input), borderWidth * borderHeight * 4);
  const noBorders = { ...input, passNames: ["political"] };
  assert.equal(estimateExportRenderBytes({ ...noBorders, riverInternalContours: true }), estimateExportRenderBytes(noBorders));
  assert.equal(EXPORT_RENDER_BUDGET_BYTES, 640 * 1024 * 1024);
});
// Exercise the actual synchronous export entry, not a copy of the readiness guard.
test("export budget reserves a padded background texture output and bounded GL canvas only with a background pass", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["background"] };
  // The background pass is a transformed pass with 15% overscan on each side.
  const padded = (size) => Math.floor((size + 2 * Math.ceil(size * 0.15)) * 2);
  for (const [width, height] of [[100, 80], [3000, 1000], [3000, 2500]]) {
    const target = { ...input, width, height };
    const [passWidth, passHeight] = [padded(width), padded(height)];
    assert.equal(estimateExportRenderBytes({ ...target, bathymetryCoverage: true })
      - estimateExportRenderBytes(target),
    (passWidth * passHeight + Math.min(4096, passWidth) * Math.min(4096, passHeight)) * 4);
  }
  const nearLimit = { width: 5800, height: 3000, pixelRatio: 1, passNames: ["background", "political", "borders"] };
  assert.ok(estimateExportRenderBytes(nearLimit) < EXPORT_RENDER_BUDGET_BYTES);
  assert.ok(estimateExportRenderBytes({ ...nearLimit, bathymetryCoverage: true }) > EXPORT_RENDER_BUDGET_BYTES);
  const withoutBackground = { ...input, passNames: ["labels"] };
  assert.equal(estimateExportRenderBytes({ ...withoutBackground, bathymetryCoverage: true }),
    estimateExportRenderBytes(withoutBackground));
});

test("physical brush exports account for scratch pixels and inverse projection cache", () => {
  const input = { width: 100, height: 80, pixelRatio: 2, passNames: ["physicalBase"] };
  assert.ok(estimateExportRenderBytes({ ...input, physicalIntensity: true }) > estimateExportRenderBytes(input) + 100 * 80 * 4 * 8);
});

