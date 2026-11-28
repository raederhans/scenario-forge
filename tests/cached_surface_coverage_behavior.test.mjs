import assert from "node:assert/strict";
import test from "node:test";
import { coversViewport, getSurfaceCoverage, intersectCoverage, transformCoverage } from "../js/core/renderer/cached_surface_coverage.js";

const origin = { x: 0, y: 0, k: 1 };

test("painted margins support short/reverse pans but reject exposed edges and zoom-out", () => {
  const coverage = getSurfaceCoverage({ width: 1500, height: 1050 }, { offsetX: 100, offsetY: 50, dpr: 1.5 });
  assert.deepEqual(coverage, { minX: -100, minY: -50, maxX: 900, maxY: 650 });
  for (const x of [-100, 0, 100]) assert.equal(coversViewport(transformCoverage(coverage, origin, { ...origin, x }), 800, 600), true);
  for (const x of [-101, 101, 300]) assert.equal(coversViewport(transformCoverage(coverage, origin, { ...origin, x }), 800, 600), false);
  assert.equal(coversViewport(transformCoverage(coverage, origin, { x: 200, y: 150, k: 0.5 }), 800, 600), false);
  assert.equal(coversViewport(transformCoverage(coverage, origin, { x: -400, y: -300, k: 2 }), 800, 600), true);
  assert.equal(coversViewport(null, 800, 600), false);
  assert.equal(coversViewport({ ...coverage, maxX: NaN }, 800, 600), false);
});

test("compositing into a larger canvas cannot manufacture painted coverage", () => {
  const padded = { minX: -100, minY: -50, maxX: 900, maxY: 650 };
  const viewportOnly = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  const actual = intersectCoverage(padded, viewportOnly);
  assert.deepEqual(actual, viewportOnly);
  assert.equal(coversViewport(transformCoverage(actual, origin, { ...origin, x: 1 }), 800, 600), false);
});
