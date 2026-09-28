import assert from "node:assert/strict";
import test from "node:test";
import { createOceanSurfacePattern } from "../js/core/renderer/ocean_surface_pattern.js";

test("ocean surface aligns with projected geometry at zoom, overscan and export DPR", () => {
  for (const dpr of [1, 1.5, 3]) for (const k of [0.5, 1, 5]) {
    let matrix;
    const canvas = {};
    const pattern = { setTransform(value) { matrix = value; } };
    const context = { createPattern(source, repeat) {
      assert.equal(source, canvas);
      assert.equal(repeat, "no-repeat");
      return pattern;
    } };
    const transform = { k, x: -170, y: 42 };
    const layout = { dpr, offsetX: 150, offsetY: 80 };
    assert.equal(createOceanSurfacePattern(context, canvas, layout, transform), pattern);
    const point = { x: 210, y: 73 };
    const pixelX = dpr * (k * point.x + transform.x + layout.offsetX);
    const pixelY = dpr * (k * point.y + transform.y + layout.offsetY);
    assert.ok(Math.abs(matrix.a * pixelX + matrix.e - point.x) < 1e-9);
    assert.ok(Math.abs(matrix.d * pixelY + matrix.f - point.y) < 1e-9);
  }
});

test("ocean surface waits for a prepared background", () => {
  assert.equal(createOceanSurfacePattern({}, null, {}, {}), null);
  assert.equal(createOceanSurfacePattern({}, {}, { dpr: 0 }, { k: 1 }), null);
});
