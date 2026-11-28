import assert from "node:assert/strict";
import test from "node:test";
import { planPhysicalViewportSurface } from "../js/core/renderer/physical_raster_surface.js";

const layout = { offsetX: 37, offsetY: 43, logicalWidth: 736, logicalHeight: 844,
  paddedWidth: 810, paddedHeight: 930, pixelWidth: 1620, pixelHeight: 1860, dpr: 2 };

test("final physical surface preserves every native viewport grid and camera value", () => {
  const fractional = { ...layout, dpr: 1.25, pixelWidth: 1013, pixelHeight: 1163 };
  assert.deepEqual(planPhysicalViewportSurface(fractional, { k: 1, x: 0, y: 0 }).layout, fractional,
    "integer rounding from the native layout must not be recomputed");
});

test("invalid viewport or camera plans use native fallback without allocating an alternate grid", () => {
  for (const invalid of [null, { k: 0, x: 0, y: 0 }, { k: 1, x: Infinity, y: 0 }]) {
    assert.equal(planPhysicalViewportSurface(layout, invalid), null);
  }
});
