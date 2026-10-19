import assert from "node:assert/strict";
import test from "node:test";
import { planPhysicalViewportSurface } from "../js/core/renderer/physical_raster_surface.js";

const layout = { offsetX: 37, offsetY: 43, logicalWidth: 736, logicalHeight: 844,
  paddedWidth: 810, paddedHeight: 930, pixelWidth: 1620, pixelHeight: 1860, dpr: 2 };

test("final physical surface preserves every native viewport grid and camera value", () => {
  for (const k of [1, 1.3, 2.5]) {
    const transform = { k, x: -552.25, y: -633.0000000000002 };
    const plan = planPhysicalViewportSurface(layout, transform);
    assert.deepEqual(plan, { layout, reference: transform });
    assert.notEqual(plan.layout, layout);
    assert.notEqual(plan.reference, transform);
    transform.x = 0;
    assert.equal(plan.reference.x, -552.25, "candidate reference cannot follow a later caller mutation");
    assert.equal(plan.layout.fullWorld, undefined);
  }
  const fractional = { ...layout, dpr: 1.25, pixelWidth: 1013, pixelHeight: 1163 };
  assert.deepEqual(planPhysicalViewportSurface(fractional, { k: 1, x: 0, y: 0 }).layout, fractional,
    "integer rounding from the native layout must not be recomputed");
});

test("a native physical candidate has one backing under the existing 80 MiB cap", () => {
  const transform = { k: 1, x: 0, y: 0 }, bytes = layout.pixelWidth * layout.pixelHeight * 4;
  assert.ok(planPhysicalViewportSurface(layout, transform, { maxBytes: bytes }));
  assert.equal(planPhysicalViewportSurface(layout, transform, { maxBytes: bytes - 1 }), null);
  assert.equal(planPhysicalViewportSurface({ ...layout, pixelWidth: 8192, pixelHeight: 8192 }, transform), null);
});

test("invalid viewport or camera plans use native fallback without allocating an alternate grid", () => {
  const transform = { k: 1, x: 0, y: 0 };
  for (const invalid of [null, { ...layout, offsetX: NaN }, { ...layout, dpr: 0 },
    { ...layout, logicalHeight: 0 }, { ...layout, paddedWidth: Infinity },
    { ...layout, pixelWidth: 1.5 }, { ...layout, pixelHeight: 0 }]) {
    assert.equal(planPhysicalViewportSurface(invalid, transform), null);
  }
  for (const invalid of [null, { k: 0, x: 0, y: 0 }, { k: 1, x: Infinity, y: 0 }]) {
    assert.equal(planPhysicalViewportSurface(layout, invalid), null);
  }
});
